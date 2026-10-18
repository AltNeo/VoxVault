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

  const respond = async (action: 'confirm' | 'dismiss' | 'ignore') => {
    if (!window.electronAPI?.respondToAutoRecordPrompt || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    await window.electronAPI.respondToAutoRecordPrompt(action).catch(() => undefined);
    setIsSubmitting(false);
  };

  const isStartPrompt = promptState.kind === 'start';
  const heading = isStartPrompt ? 'Teams call started' : 'Teams call ended';
  const detail = isStartPrompt
    ? `${promptState.title ?? 'A Teams meeting'} · Record this call?`
    : `${promptState.title ?? 'Your recording'} · Stop and save the recording?`;
  const confirmLabel = isStartPrompt ? 'Record' : 'Stop';
  const dismissLabel = isStartPrompt ? 'Not now' : 'Keep recording';
  const disabled = isSubmitting || !promptState.visible;

  return (
    <main className="call-toast">
      <section className="call-toast__card" role="alertdialog" aria-labelledby="call-toast-title">
        <div className="call-toast__head">
          <span className="call-toast__icon" aria-hidden="true">
            T
          </span>
          <div className="call-toast__text">
            <h1 className="call-toast__title" id="call-toast-title">
              {heading}
            </h1>
            <p className="call-toast__detail">{detail}</p>
          </div>
        </div>
        <div className="call-toast__actions">
          <button
            className="call-toast__button call-toast__button--primary"
            type="button"
            disabled={disabled}
            onClick={() => void respond('confirm')}
          >
            {confirmLabel}
          </button>
          <button
            className="call-toast__button"
            type="button"
            disabled={disabled}
            onClick={() => void respond('dismiss')}
          >
            {dismissLabel}
          </button>
        </div>
        {isStartPrompt && (
          <button
            className="call-toast__link"
            type="button"
            disabled={disabled}
            onClick={() => void respond('ignore')}
          >
            Don&apos;t ask again for this meeting
          </button>
        )}
      </section>
    </main>
  );
}
