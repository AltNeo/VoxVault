import type { TranscriptionSummary } from '../types/api';

interface TranscriptionHistoryProps {
  items: TranscriptionSummary[];
  activeId?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  onSelect: (id: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Earlier';
  }
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const now = new Date();
  const sameDay = startOfDay(date) === startOfDay(now);
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

export default function TranscriptionHistory({
  items,
  activeId,
  isLoading = false,
  emptyMessage = 'No recordings yet. Record a call or upload a file to get started.',
  onSelect,
}: TranscriptionHistoryProps) {
  if (isLoading && items.length === 0) {
    return <p className="hist__empty">Loading recordings…</p>;
  }
  if (items.length === 0) {
    return <p className="hist__empty">{emptyMessage}</p>;
  }

  let lastGroup = '';
  return (
    <ul className="hist">
      {items.map((item) => {
        const group = groupLabel(item.created_at);
        const showGroup = group !== lastGroup;
        lastGroup = group;
        const duration = formatDuration(item.duration_seconds);
        const failed = item.status === 'failed';
        return (
          <li key={item.id}>
            {showGroup && <p className="hist__group">{group}</p>}
            <button
              className={`hist__item ${activeId === item.id ? 'hist__item--active' : ''}`}
              type="button"
              aria-current={activeId === item.id ? 'true' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className={`hist__icon ${failed ? 'hist__icon--failed' : ''}`} aria-hidden="true">
                {failed ? '!' : item.source === 'recording' ? '●' : '↑'}
              </span>
              <span className="hist__text">
                <b>{item.title}</b>
                <small>
                  {[formatTime(item.created_at), duration].filter(Boolean).join(' · ')}
                  {failed && <span className="hist__badge hist__badge--failed">Not transcribed</span>}
                  {!failed && item.summary_text?.trim() && (
                    <span className="hist__badge">Summary</span>
                  )}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
