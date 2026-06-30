import type { WordResult } from "../types";

interface WordPillProps {
  result: WordResult;
  index: number;
}

export function WordPill({ result, index }: WordPillProps) {
  const isCorrect = result.correct;
  const tooltipPieces: string[] = [];
  if (typeof result.score === "number") {
    tooltipPieces.push(`${Math.round(result.score)}/100`);
  }
  if (result.feedback) tooltipPieces.push(result.feedback);
  const tooltip = tooltipPieces.join(" · ");

  return (
    <span
      title={tooltip || undefined}
      className={[
        "group inline-flex flex-col items-start gap-0.5",
        "rounded-lg px-2.5 py-1 text-sm font-medium",
        "transition-transform duration-150 ease-out hover:scale-105 cursor-default",
        "animate-fade-in-up",
        isCorrect
          ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
          : "bg-rose-500/10 border border-rose-500/30 text-rose-300",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index, 60) * 60}ms` }}
    >
      <span className={isCorrect ? "" : "line-through decoration-rose-400/60"}>
        {result.word}
      </span>
      {!isCorrect && result.heard ? (
        <span className="text-[10px] font-medium text-zinc-500 normal-case tracking-wide">
          heard: <span className="text-zinc-400">{result.heard}</span>
        </span>
      ) : null}
    </span>
  );
}
