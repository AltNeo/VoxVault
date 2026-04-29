from __future__ import annotations

import asyncio
import gc
import logging
import re
import threading
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.core.exceptions import APIError

logger = logging.getLogger("app.transactions")

DEFAULT_SUMMARY_PROMPT = (
    "You are a meeting summarizer. Given a meeting transcript, produce a structured summary with: "
    "Key Topics, Decisions Made, Action Items (with owners if mentioned), and a Brief Summary paragraph."
)


class SummaryService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: Any = None
        self._model_path: Path | None = None
        self._backend = "unavailable"
        self._backend_detail = "Summary model is not loaded."
        self._lock = threading.RLock()

    async def warmup(self) -> None:
        try:
            await asyncio.to_thread(self._ensure_model_loaded)
        except Exception as exc:
            if self._settings.summary_fallback_enabled:
                logger.warning("summary.model.warmup_failed_using_fallback reason=%s", exc)
                with self._lock:
                    self._backend = "extractive-fallback"
                    self._backend_detail = (
                        "Local GGUF summary model is unavailable; using built-in extractive fallback."
                    )
                return
            raise APIError(
                code="SUMMARY_MODEL_WARMUP_FAILED",
                message="Failed to load local summary model.",
                status_code=503,
                details={"reason": str(exc)},
            ) from exc

    def is_ready(self) -> bool:
        with self._lock:
            if self._backend == "local-llama":
                return self._model is not None
            return self._backend == "extractive-fallback"

    @property
    def model_name(self) -> str | None:
        with self._lock:
            if self._backend == "local-llama":
                return self._settings.summary_model_filename
            if self._backend == "extractive-fallback":
                return "extractive-fallback"
            return None

    @property
    def detail(self) -> str:
        with self._lock:
            return self._backend_detail

    async def summarize(
        self,
        transcript_text: str,
        custom_prompt: str | None = None,
    ) -> str:
        transcript = transcript_text.strip()
        if not transcript:
            raise APIError(
                code="EMPTY_TRANSCRIPT",
                message="Transcript text is required.",
                status_code=400,
            )

        if not self.is_ready():
            raise APIError(
                code="SUMMARY_MODEL_NOT_READY",
                message="Summary model is not loaded.",
                status_code=503,
            )

        return await asyncio.to_thread(self._summarize_sync, transcript, custom_prompt)

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._model_path = None
            if self._settings.summary_fallback_enabled:
                self._backend = "extractive-fallback"
                self._backend_detail = "Using built-in extractive summary fallback."
            else:
                self._backend = "unavailable"
                self._backend_detail = "Summary model is not loaded."
        gc.collect()

    def _ensure_model_loaded(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            if not self._settings.summary_model_enabled:
                if self._settings.summary_fallback_enabled:
                    self._backend = "extractive-fallback"
                    self._backend_detail = "Using built-in extractive summary fallback."
                    return
                self._backend = "unavailable"
                self._backend_detail = "Summary model is not loaded."
                return
            model_path = self._resolve_model_path()
            self._model = self._load_model(model_path)
            self._model_path = model_path
            self._backend = "local-llama"
            self._backend_detail = f"Local GGUF summary model loaded from {model_path.name}."
            logger.info("summary.model.loaded path=%s", model_path)

    def _resolve_model_path(self) -> Path:
        download_root = self._settings.summary_model_download_root
        download_root.mkdir(parents=True, exist_ok=True)

        model_path = download_root / self._settings.summary_model_filename
        if model_path.exists():
            return model_path

        from huggingface_hub import hf_hub_download

        downloaded_path = hf_hub_download(
            repo_id=self._settings.summary_model_repo,
            filename=self._settings.summary_model_filename,
            local_dir=str(download_root),
        )
        return Path(downloaded_path)

    def _load_model(self, model_path: Path) -> Any:
        from llama_cpp import Llama

        return Llama(
            model_path=str(model_path),
            n_ctx=self._settings.summary_n_ctx,
            n_threads=self._settings.summary_n_threads,
            verbose=False,
        )

    def _summarize_sync(self, transcript_text: str, custom_prompt: str | None) -> str:
        with self._lock:
            system_prompt = self._normalize_prompt(custom_prompt)
            if self._backend == "local-llama":
                if self._model is None:
                    raise APIError(
                        code="SUMMARY_MODEL_NOT_READY",
                        message="Summary model is not loaded.",
                        status_code=503,
                    )
                summary_text = self._summarize_with_model(transcript_text, system_prompt)
            elif self._backend == "extractive-fallback":
                summary_text = self._summarize_with_fallback(transcript_text, system_prompt)
            else:
                raise APIError(
                    code="SUMMARY_MODEL_NOT_READY",
                    message="Summary model is not loaded.",
                    status_code=503,
                )

            if not summary_text:
                raise APIError(
                    code="SUMMARY_GENERATION_FAILED",
                    message="Summary model returned an empty response.",
                    status_code=502,
                )
            return summary_text

    def _summarize_with_model(self, transcript_text: str, system_prompt: str) -> str:
        assert self._model is not None
        direct_prompt = "Summarize the following meeting transcript:\n\n"
        if self._fits_context(system_prompt, direct_prompt, transcript_text, self._settings.summary_max_tokens):
            return self._run_model_prompt(
                system_prompt=system_prompt,
                user_prefix=direct_prompt,
                user_text=transcript_text,
                max_tokens=self._settings.summary_max_tokens,
            )

        logger.info("summary.chunking_started")

        chunk_max_tokens = max(16, min(self._settings.summary_max_tokens // 2, 512))
        chunk_prompt = (
            "Summarize this portion of the meeting transcript. Keep concrete facts, decisions, "
            "owners, dates, blockers, and action items.\n\n"
        )
        chunks = self._chunk_transcript_for_model(
            transcript_text,
            system_prompt=system_prompt,
            user_prefix=chunk_prompt,
            response_tokens=chunk_max_tokens,
        )

        partial_summaries: list[str] = []
        for index, chunk in enumerate(chunks, start=1):
            partial_summary = self._run_model_prompt(
                system_prompt=system_prompt,
                user_prefix=chunk_prompt,
                user_text=chunk,
                max_tokens=chunk_max_tokens,
            )
            partial_summaries.append(f"Chunk {index} summary:\n{partial_summary}")

        final_prompt = (
            "Combine these chunk summaries into one final meeting summary. Preserve important "
            "topics, decisions made, action items with owners, and a brief overall summary.\n\n"
        )
        try:
            return self._combine_model_summaries(partial_summaries, system_prompt, final_prompt)
        except Exception as exc:
            logger.exception("summary.generate_failed")
            raise APIError(
                code="SUMMARY_GENERATION_FAILED",
                message="Failed to generate summary.",
                status_code=502,
                details={"reason": str(exc)},
            ) from exc

    def _summarize_with_fallback(self, transcript_text: str, system_prompt: str) -> str:
        sentences = self._split_sentences(transcript_text)
        if not sentences:
            return transcript_text.strip()

        selected = self._select_key_sentences(
            sentences,
            max_sentences=self._settings.summary_fallback_max_sentences,
        )
        action_items = self._extract_action_items(sentences)
        decisions = self._extract_decisions(sentences)
        topics = self._extract_topics(sentences, limit=4)
        brief_summary = " ".join(selected)

        sections = [
            "Key Topics:",
            *(f"- {topic}" for topic in topics),
            "",
            "Decisions Made:",
            *(f"- {item}" for item in decisions),
            "",
            "Action Items:",
            *(f"- {item}" for item in action_items),
            "",
            "Brief Summary:",
            brief_summary,
        ]

        if system_prompt != DEFAULT_SUMMARY_PROMPT:
            sections.extend(["", f"Prompt Applied: {system_prompt}"])

        return "\n".join(
            line
            for line in sections
            if line or (sections and line == "")
        ).strip()

    @staticmethod
    def _split_sentences(transcript_text: str) -> list[str]:
        normalized = re.sub(r"\s+", " ", transcript_text).strip()
        if not normalized:
            return []
        parts = re.split(r"(?<=[.!?])\s+", normalized)
        return [part.strip(" -") for part in parts if part.strip(" -")]

    @staticmethod
    def _score_sentence(sentence: str) -> int:
        lower = sentence.lower()
        score = 0
        keywords = {
            "decide": 3,
            "decision": 3,
            "action": 3,
            "next": 2,
            "follow up": 3,
            "owner": 2,
            "deadline": 2,
            "ship": 2,
            "blocker": 2,
            "risk": 2,
            "plan": 1,
            "summary": 1,
        }
        for phrase, weight in keywords.items():
            if phrase in lower:
                score += weight
        score += min(len(sentence.split()) // 8, 3)
        return score

    @classmethod
    def _select_key_sentences(cls, sentences: list[str], max_sentences: int) -> list[str]:
        ranked = sorted(
            enumerate(sentences),
            key=lambda item: (cls._score_sentence(item[1]), -item[0]),
            reverse=True,
        )
        selected_indexes = sorted(index for index, _ in ranked[:max_sentences])
        return [sentences[index] for index in selected_indexes]

    @staticmethod
    def _extract_action_items(sentences: list[str]) -> list[str]:
        matches = [
            sentence
            for sentence in sentences
            if re.search(
                r"\b(action item|follow up|follow-up|todo|to do|next step|need to|will)\b",
                sentence,
                flags=re.IGNORECASE,
            )
        ]
        return matches[:4] or ["No explicit action items identified."]

    @staticmethod
    def _extract_decisions(sentences: list[str]) -> list[str]:
        matches = [
            sentence
            for sentence in sentences
            if re.search(
                r"\b(decided|decision|agreed|approved|chosen|we will|moving forward)\b",
                sentence,
                flags=re.IGNORECASE,
            )
        ]
        return matches[:4] or ["No explicit decisions identified."]

    @staticmethod
    def _extract_topics(sentences: list[str], limit: int) -> list[str]:
        topics: list[str] = []
        for sentence in sentences:
            cleaned = sentence.strip()
            if not cleaned:
                continue
            fragment = cleaned[:120].rstrip(" ,;:")
            if fragment not in topics:
                topics.append(fragment)
            if len(topics) >= limit:
                break
        return topics or ["Transcript overview"]

    @staticmethod
    def _normalize_prompt(custom_prompt: str | None) -> str:
        prompt = custom_prompt.strip() if custom_prompt else ""
        return prompt or DEFAULT_SUMMARY_PROMPT

    @staticmethod
    def _extract_summary_text(response: Any) -> str:
        if isinstance(response, dict):
            choices = response.get("choices")
            if isinstance(choices, list) and choices:
                choice = choices[0]
                if isinstance(choice, dict):
                    message = choice.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, str):
                            return content.strip()
                        if content is not None:
                            return str(content).strip()

        if response is None:
            return ""
        return str(response).strip()

    def _run_model_prompt(
        self,
        *,
        system_prompt: str,
        user_prefix: str,
        user_text: str,
        max_tokens: int,
    ) -> str:
        assert self._model is not None
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"{user_prefix}{user_text}"},
        ]
        response = self._model.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.3,
        )
        return self._extract_summary_text(response)

    def _fits_context(
        self,
        system_prompt: str,
        user_prefix: str,
        user_text: str,
        response_tokens: int,
    ) -> bool:
        return (
            self._estimate_prompt_tokens(system_prompt, user_prefix, user_text) + response_tokens
            <= self._settings.summary_n_ctx
        )

    def _estimate_prompt_tokens(self, system_prompt: str, user_prefix: str, user_text: str) -> int:
        overhead_tokens = 32
        return (
            self._estimate_token_count(system_prompt)
            + self._estimate_token_count(user_prefix)
            + self._estimate_token_count(user_text)
            + overhead_tokens
        )

    def _estimate_token_count(self, text: str) -> int:
        if not text:
            return 0
        tokenize = getattr(self._model, "tokenize", None)
        if callable(tokenize):
            try:
                encoded = text.encode("utf-8", errors="ignore")
                return len(tokenize(encoded))
            except Exception:
                pass
        return max(1, len(text) // 4)

    def _chunk_transcript_for_model(
        self,
        transcript_text: str,
        *,
        system_prompt: str,
        user_prefix: str,
        response_tokens: int,
    ) -> list[str]:
        sentences = self._split_sentences(transcript_text)
        if not sentences:
            return [transcript_text.strip()]

        chunks: list[str] = []
        current_chunk: list[str] = []
        for sentence in sentences:
            candidate = " ".join([*current_chunk, sentence]).strip()
            if candidate and self._fits_context(system_prompt, user_prefix, candidate, response_tokens):
                current_chunk.append(sentence)
                continue

            if current_chunk:
                chunks.append(" ".join(current_chunk).strip())
                current_chunk = []

            if self._fits_context(system_prompt, user_prefix, sentence, response_tokens):
                current_chunk.append(sentence)
                continue

            chunks.extend(
                self._split_long_sentence(
                    sentence,
                    system_prompt=system_prompt,
                    user_prefix=user_prefix,
                    response_tokens=response_tokens,
                )
            )

        if current_chunk:
            chunks.append(" ".join(current_chunk).strip())

        return [chunk for chunk in chunks if chunk]

    def _split_long_sentence(
        self,
        sentence: str,
        *,
        system_prompt: str,
        user_prefix: str,
        response_tokens: int,
    ) -> list[str]:
        words = sentence.split()
        if not words:
            return []

        parts: list[str] = []
        current_words: list[str] = []
        for word in words:
            candidate = " ".join([*current_words, word]).strip()
            if candidate and self._fits_context(system_prompt, user_prefix, candidate, response_tokens):
                current_words.append(word)
                continue
            if current_words:
                parts.append(" ".join(current_words))
            current_words = [word]

        if current_words:
            parts.append(" ".join(current_words))
        return parts

    def _combine_model_summaries(
        self,
        summaries: list[str],
        system_prompt: str,
        final_prompt: str,
    ) -> str:
        labeled_summaries = [f"Chunk {index} summary:\n{summary}" for index, summary in enumerate(summaries, start=1)]
        combined_text = "\n\n".join(labeled_summaries)
        if self._fits_context(
            system_prompt,
            final_prompt,
            combined_text,
            self._settings.summary_max_tokens,
        ):
            return self._run_model_prompt(
                system_prompt=system_prompt,
                user_prefix=final_prompt,
                user_text=combined_text,
                max_tokens=self._settings.summary_max_tokens,
            )

        reduction_prompt = (
            "Compress these meeting-summary notes while preserving decisions, action items, owners, "
            "dates, and blockers.\n\n"
        )
        reduction_tokens = max(16, min(self._settings.summary_max_tokens // 2, 512))
        groups = self._group_text_items_for_model(
            labeled_summaries,
            system_prompt=system_prompt,
            user_prefix=reduction_prompt,
            response_tokens=reduction_tokens,
        )
        if len(groups) <= 1:
            raise APIError(
                code="SUMMARY_INPUT_TOO_LARGE",
                message="Transcript is too large for the configured summary model context window.",
                status_code=422,
            )

        reduced_summaries = [
            self._run_model_prompt(
                system_prompt=system_prompt,
                user_prefix=reduction_prompt,
                user_text=group,
                max_tokens=reduction_tokens,
            )
            for group in groups
        ]
        return self._combine_model_summaries(reduced_summaries, system_prompt, final_prompt)

    def _group_text_items_for_model(
        self,
        items: list[str],
        *,
        system_prompt: str,
        user_prefix: str,
        response_tokens: int,
    ) -> list[str]:
        groups: list[str] = []
        current_group: list[str] = []
        for item in items:
            candidate = "\n\n".join([*current_group, item]).strip()
            if candidate and self._fits_context(system_prompt, user_prefix, candidate, response_tokens):
                current_group.append(item)
                continue

            if current_group:
                groups.append("\n\n".join(current_group).strip())
                current_group = []

            if self._fits_context(system_prompt, user_prefix, item, response_tokens):
                current_group.append(item)
                continue

            raise APIError(
                code="SUMMARY_INPUT_TOO_LARGE",
                message="Transcript is too large for the configured summary model context window.",
                status_code=422,
            )

        if current_group:
            groups.append("\n\n".join(current_group).strip())
        return groups
