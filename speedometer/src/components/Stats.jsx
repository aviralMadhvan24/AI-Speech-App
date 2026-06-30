function formatElapsed(secs) {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins}:${String(s).padStart(2, '0')}`;
}

export default function Stats({ totalWords, elapsedSecs, avgWpm, accuracyPct }) {
  return (
    <div className="stats">
      <div className="stat-card">
        <div className="stat-value">{totalWords}</div>
        <div className="stat-label">Total Words</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{formatElapsed(elapsedSecs)}</div>
        <div className="stat-label">Elapsed</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{avgWpm}</div>
        <div className="stat-label">Avg WPM</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{accuracyPct}%</div>
        <div className="stat-label">Accuracy</div>
      </div>
    </div>
  );
}
