interface ScoreBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function bandFor(score: number | null) {
  if (score == null || !Number.isFinite(score)) {
    return {
      bg: "bg-zinc-800/70",
      ring: "ring-zinc-700/70",
      text: "text-zinc-400",
      label: "—",
    };
  }
  if (score >= 90)
    return {
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-500/40",
      text: "text-emerald-300",
      label: String(Math.round(score)),
    };
  if (score >= 70)
    return {
      bg: "bg-sky-500/10",
      ring: "ring-sky-500/40",
      text: "text-sky-300",
      label: String(Math.round(score)),
    };
  if (score >= 50)
    return {
      bg: "bg-amber-500/10",
      ring: "ring-amber-500/40",
      text: "text-amber-300",
      label: String(Math.round(score)),
    };
  return {
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/40",
    text: "text-rose-300",
    label: String(Math.round(score)),
  };
}

export function ScoreBadge({ score, size = "md", className }: ScoreBadgeProps) {
  const band = bandFor(score);
  const sizing =
    size === "lg"
      ? "w-16 h-16 text-2xl"
      : size === "sm"
        ? "w-9 h-9 text-xs"
        : "w-12 h-12 text-base";
  return (
    <div
      className={[
        "inline-flex items-center justify-center rounded-xl ring-1 font-bold tabular-nums",
        sizing,
        band.bg,
        band.ring,
        band.text,
        className ?? "",
      ].join(" ")}
      aria-label={`Score ${band.label}`}
    >
      {band.label}
    </div>
  );
}
