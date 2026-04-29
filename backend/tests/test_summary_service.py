import asyncio

from app.core.config import Settings
from app.services.summary_service import SummaryService


class ContextLimitedSummaryModel:
    def __init__(self, n_ctx: int) -> None:
        self.n_ctx = n_ctx
        self.calls: list[dict[str, object]] = []

    def tokenize(self, data: bytes) -> list[bytes]:
        return [token for token in data.decode("utf-8").split() if token]

    def create_chat_completion(self, *, messages, max_tokens, temperature):
        prompt_tokens = sum(len(self.tokenize(message["content"].encode("utf-8"))) for message in messages)
        requested_tokens = prompt_tokens + max_tokens
        if requested_tokens > self.n_ctx:
            raise ValueError(
                f"Requested tokens ({requested_tokens}) exceed context window of {self.n_ctx}"
            )

        user_content = messages[-1]["content"]
        self.calls.append({"messages": messages, "max_tokens": max_tokens})
        if user_content.startswith("Summarize this portion"):
            content = "chunk summary: rollout, owners, blockers"
        elif user_content.startswith("Compress these meeting-summary notes"):
            content = "compressed: rollout, owners, blockers"
        else:
            content = (
                "Key Topics:\n"
                "- rollout\n\n"
                "Decisions Made:\n"
                "- keep the rollout\n\n"
                "Action Items:\n"
                "- confirm numbers\n\n"
                "Brief Summary:\n"
                "combined summary"
            )
        return {
            "choices": [
                {
                    "message": {"content": content}
                }
            ]
        }


def test_summary_service_chunks_long_transcripts_for_local_model(tmp_path) -> None:
    settings = Settings(
        backup_dir=tmp_path / "backups",
        sqlite_path=tmp_path / "transcriptions.db",
        diagnostics_log_path=tmp_path / "diagnostics" / "transactions.log",
        summary_model_enabled=True,
        summary_fallback_enabled=False,
        summary_n_ctx=140,
        summary_max_tokens=20,
    )
    service = SummaryService(settings)
    service._backend = "local-llama"
    service._model = ContextLimitedSummaryModel(n_ctx=settings.summary_n_ctx)

    transcript = " ".join(
        f"Sentence {index} covers revman updates, actions, owners, blockers, and deadlines."
        for index in range(1, 21)
    )
    summary_text = asyncio.run(service.summarize(transcript))

    assert "Key Topics:" in summary_text
    assert "Decisions Made:" in summary_text
    assert "Action Items:" in summary_text
    assert len(service._model.calls) > 1
