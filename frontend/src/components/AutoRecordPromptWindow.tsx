import { useEffect, useState } from 'react';

type PromptState = {
  visible: boolean;
  kind: 'start' | 'stop';
  title: string | null;
  updatedAt: string | null;
};

const EMPTY_PROMPT_STATE: PromptState = {
  visible: false,
  kind: 'start',
  title: null,
  updatedAt: null,
};

export default function AutoRecordPromptWindow() {
  const [promptState, setPromptState] = useState<PromptState>(EMPTY_PROMPT_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.electronAPI?.getAutoRecordPromptState?.().then((state) => {
      if (!cancelled && state) {
        setPromptState(state);
      }
    });

    const unsubscribe = window.electronAPI?.onAutoRecordPromptStateChanged?.((state) => {
      setPromptState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const respond = async (action: 'confirm' | 'dismiss') => {
    if (!window.electronAPI?.respondToAutoRecordPrompt || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    await window.electronAPI.respondToAutoRecordPrompt(action).catch(() => undefined);
    setIsSubmitting(false);
  };

  const isStartPrompt = promptState.kind === 'start';
  const eyebrow = isStartPrompt ? 'Teams window detected' : 'Recording in progress';
  const title = isStartPrompt ? 'Start recording?' : 'Stop recording?';
  const detail = isStartPrompt
    ? promptState.title ?? 'A Microsoft Teams meeting window was detected.'
    : promptState.title
      ? `Current recording: ${promptState.title}`
      : 'Your current recording will be finalized if you stop now.';
  const hint = isStartPrompt
    ? 'This popup stays on top until you choose whether VoxVault should start recording.'
    : 'Choose stop to finish and save the current recording, or continue recording.';
  const confirmLabel = isStartPrompt ? 'Record' : 'Stop';
  const dismissLabel = isStartPrompt ? 'Ignore title' : 'Continue';

  return (
    <main className="prompt-window">
      <section className="prompt-window__card">
        <p className="prompt-window__eyebrow">{eyebrow}</p>
        <h1 className="prompt-window__title">{title}</h1>
        <p className="prompt-window__meeting">{detail}</p>
        <p className="prompt-window__hint">{hint}</p>
        <div className="prompt-window__actions">
          <button
            className="btn btn--primary prompt-window__button"
            type="button"
            disabled={isSubmitting || !promptState.visible}
            onClick={() => void respond('confirm')}
          >
            {confirmLabel}
          </button>
          <button
            className="btn btn--ghost prompt-window__button"
            type="button"
            disabled={isSubmitting || !promptState.visible}
            onClick={() => void respond('dismiss')}
          >
            {dismissLabel}
          </button>
        </div>
      </section>
    </main>
  );
}
