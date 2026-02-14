interface AudioPlayerProps {
  src: string | null;
  label?: string;
}

export default function AudioPlayer({ src, label }: AudioPlayerProps) {
  return (
    <section className="module">
      <div className="module__head">
        <h3>Audio Player</h3>
      </div>
      <p className="muted">{label ?? 'Preview the current recording or uploaded clip.'}</p>
      {src ? (
        <audio className="audio-player" controls src={src}>
          <track kind="captions" />
        </audio>
      ) : (
        <p className="placeholder-text">No audio selected yet.</p>
      )}
    </section>
  );
}
