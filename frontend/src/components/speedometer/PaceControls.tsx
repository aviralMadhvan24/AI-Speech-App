import { Mic, MicOff, RotateCcw } from "lucide-react";

interface PaceControlsProps {
  isListening: boolean;
  canStart: boolean;
  onToggle: () => void;
  onReset: () => void;
}

export function PaceControls({ isListening, canStart, onToggle, onReset }: PaceControlsProps) {
  const startDisabled = !canStart && !isListening;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={startDisabled}
        aria-label={isListening ? "Stop listening" : "Start listening for speech"}
        onClick={onToggle}
        className={[
          isListening ? "btn-danger" : "btn-primary",
          "px-5 py-2.5 inline-flex items-center gap-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {isListening ? (
          <>
            <MicOff className="w-4 h-4" />
            Stop
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" />
            Start
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onReset}
        className="btn-ghost px-4 py-2.5 inline-flex items-center gap-2"
        aria-label="Reset stats"
      >
        <RotateCcw className="w-4 h-4" />
        Reset
      </button>
    </div>
  );
}
