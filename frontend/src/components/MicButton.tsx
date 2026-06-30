import { Mic, Square } from "lucide-react";

interface MicButtonProps {
  isRecording: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function MicButton({ isRecording, onClick, disabled }: MicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isRecording}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
      className={[
        "relative inline-flex items-center justify-center",
        "w-24 h-24 rounded-full",
        "text-white transition-all duration-200 ease-out",
        "active:scale-[0.95] disabled:opacity-50 disabled:cursor-not-allowed",
        isRecording
          ? "bg-gradient-to-br from-rose-600 to-rose-500 shadow-glow-rose"
          : "bg-gradient-to-br from-brand-600 to-brand-500 shadow-glow animate-glow-pulse hover:scale-[1.03]",
      ].join(" ")}
    >
      {isRecording && (
        <>
          <span className="absolute inset-0 rounded-full border-2 border-rose-400/50 animate-pulse-ring" />
          <span
            className="absolute inset-0 rounded-full border-2 border-rose-400/40 animate-pulse-ring"
            style={{ animationDelay: "0.4s" }}
          />
          <span
            className="absolute inset-0 rounded-full border-2 border-rose-400/30 animate-pulse-ring"
            style={{ animationDelay: "0.8s" }}
          />
        </>
      )}
      <span className="relative z-10">
        {isRecording ? (
          <Square className="w-8 h-8" strokeWidth={2.4} fill="currentColor" />
        ) : (
          <Mic className="w-9 h-9" strokeWidth={2.4} />
        )}
      </span>
    </button>
  );
}
