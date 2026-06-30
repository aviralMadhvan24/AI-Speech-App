export default function Controls({ isListening, canStart, onToggle, onReset }) {
  return (
    <div className="controls">
      <button
        type="button"
        id="startBtn"
        className={isListening ? 'listening' : ''}
        disabled={!canStart && !isListening}
        aria-label={isListening ? 'Stop listening' : 'Start listening for speech'}
        onClick={onToggle}
      >
        <span className="mic-dot" />
        {isListening ? 'Stop' : 'Start Listening'}
      </button>
      <button type="button" id="resetBtn" aria-label="Reset all stats" onClick={onReset}>
        Reset
      </button>
    </div>
  );
}
