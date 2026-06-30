export default function ReadingPanel({ tokens, statuses = [], matchedCount, progressPct, passageKey }) {
  return (
    <>
      <div className="reading-panel" aria-live="polite">
        {/* keyed so React remounts the content on passage change, replaying the
            entrance animation for a smooth transition */}
        <div className="reading-content" key={passageKey}>
          {tokens.length === 0 ? (
            <span className="reading-placeholder">Select a paragraph above to start reading...</span>
          ) : (
            tokens.map((tok, i) => {
              let cls = 'word';
              if (i === matchedCount) {
                cls += ' current';
              } else if (i < matchedCount) {
                cls += statuses[i] === 'wrong' ? ' wrong' : ' read';
              }
              return (
                <span key={`${tok}-${i}`} className={cls}>
                  {tok}{' '}
                </span>
              );
            })
          )}
        </div>
      </div>
      <div className="reading-progress">
        <div className="reading-progress-bar" style={{ width: `${progressPct}%` }} />
      </div>
    </>
  );
}
