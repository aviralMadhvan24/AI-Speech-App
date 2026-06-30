interface PaceStatsProps {
  totalWords: number;
  elapsedSecs: number;
  avgWpm: number;
  accuracyPct: number;
}

function formatElapsed(secs: number): string {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins}:${String(s).padStart(2, "0")}`;
}

export function PaceStats({
  totalWords,
  elapsedSecs,
  avgWpm,
  accuracyPct,
}: PaceStatsProps) {
  const items: Array<{ label: string; value: string | number }> = [
    { label: "Words", value: totalWords },
    { label: "Elapsed", value: formatElapsed(elapsedSecs) },
    { label: "Avg WPM", value: avgWpm },
    { label: "Accuracy", value: `${accuracyPct}%` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="card-glass px-4 py-3 text-center"
        >
          <div className="text-2xl font-bold tabular-nums text-zinc-100">
            {item.value}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-500">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}
