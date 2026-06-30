import { useAudioVisualizer } from "../hooks/useAudioVisualizer";

interface AudioVisualizerProps {
  stream: MediaStream | null;
  isRecording: boolean;
  bars?: number;
}

const MIN_HEIGHT_PX = 6;
const MAX_HEIGHT_PX = 56;

export function AudioVisualizer({
  stream,
  isRecording,
  bars = 7,
}: AudioVisualizerProps) {
  const levels = useAudioVisualizer(isRecording ? stream : null, bars);

  return (
    <div
      className="flex items-end justify-center gap-1.5 h-16"
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, index) => {
        const level = levels[index] ?? 0;
        const height = MIN_HEIGHT_PX + level * (MAX_HEIGHT_PX - MIN_HEIGHT_PX);
        return (
          <span
            key={index}
            className={[
              "w-1.5 rounded-full transition-[height,background] duration-100 ease-out",
              isRecording
                ? "bg-gradient-to-t from-rose-500 to-rose-300 shadow-[0_0_8px_-2px_rgba(244,63,94,0.6)]"
                : "bg-zinc-700",
            ].join(" ")}
            style={{ height: `${isRecording ? height : MIN_HEIGHT_PX}px` }}
          />
        );
      })}
    </div>
  );
}
