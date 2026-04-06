import { useEffect, useState } from 'react';

type PromptState = {
  visible: boolean;
  title: string | null;
  updatedAt: string | null;
};

const EMPTY_PROMPT_STATE: PromptState = {
  visible: false,
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

  return (
    <main className="prompt-window">
      <section className="prompt-window__card">
        <p className="prompt-window__eyebrow">Teams window detected</p>
        <h1 className="prompt-window__title">Start recording?</h1>
        <p className="prompt-window__meeting">
          {promptState.title ?? 'A Microsoft Teams meeting window was detected.'}
        </p>
        <p className="prompt-window__hint">
          This popup stays on top until you choose whether VoxVault should start recording.
        </p>
        <div className="prompt-window__actions">
          <button
            className="btn btn--primary prompt-window__button"
            type="button"
            disabled={isSubmitting || !promptState.visible}
            onClick={() => void respond('confirm')}
          >
            Record
          </button>
          <button
            className="btn btn--ghost prompt-window__button"
            type="button"
            disabled={isSubmitting || !promptState.visible}
            onClick={() => void respond('dismiss')}
          >
            Ignore title
          </button>
        </div>
      </section>
    </main>
  );
}
