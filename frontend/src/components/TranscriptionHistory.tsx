import type { TranscriptionSummary } from '../types/api';

interface TranscriptionHistoryProps {
  items: TranscriptionSummary[];
  activeId?: string;
  isLoading?: boolean;
  onSelect: (id: string) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TranscriptionHistory({
  items,
  activeId,
  isLoading = false,
  onSelect,
}: TranscriptionHistoryProps) {
  return (
    <section className="module">
      <div className="module__head">
        <h3>Transcription History</h3>
      </div>

      {isLoading && <p className="placeholder-text">Loading history...</p>}
      {!isLoading && items.length === 0 && (
        <p className="placeholder-text">
          No transcriptions yet. Your completed jobs will appear here.
        </p>
      )}

      <ul className="history-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`history-item ${activeId === item.id ? 'history-item--active' : ''}`}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <span className="history-item__title">{item.title}</span>
              <span className="history-item__meta">
                {item.filename} | {item.source} | {item.status} | {formatDate(item.created_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
