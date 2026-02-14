import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

interface FileUploaderProps {
  disabled?: boolean;
  onFileSelected: (file: File, previewUrl: string) => void;
}

const ACCEPTED_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.webm'];
const ACCEPTED_TYPES = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/x-wav'];

function isAllowedAudio(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  return hasValidExtension || ACCEPTED_TYPES.includes(file.type);
}

export default function FileUploader({ disabled = false, onFileSelected }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptValue = useMemo(() => ACCEPTED_EXTENSIONS.join(','), []);

  const processFile = useCallback(
    (file: File) => {
      if (!isAllowedAudio(file)) {
        setError('Unsupported file type. Use WAV, MP3, M4A, or WebM.');
        return;
      }

      setError(null);
      onFileSelected(file, URL.createObjectURL(file));
    },
    [onFileSelected]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (nextFile) {
        processFile(nextFile);
      }
      event.target.value = '';
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  return (
    <section className="module">
      <div className="module__head">
        <h3>File Uploader</h3>
      </div>
      <p className="muted">Drop an audio file or browse your local storage.</p>

      <label
        className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${
          disabled ? 'dropzone--disabled' : ''
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={acceptValue}
          disabled={disabled}
          onChange={handleInputChange}
          hidden
        />
        <strong>Drop audio here</strong>
        <span>or click to select</span>
      </label>

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
