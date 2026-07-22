import { useMemo } from "react";
import {
  ArrowRight,
  Home,
  Lightbulb,
  Repeat,
  Trophy,
} from "lucide-react";
import type { ScoreResult } from "../types";
import { useCountUp } from "../hooks/useCountUp";
import { WordPill } from "./WordPill";

interface ReportViewProps {
  report: ScoreResult;
  degraded?: boolean;
  onTryAgain: () => void;
  onHome: () => void;
}

function verdictFor(score: number): { label: string; tone: string } {
  // Stricter thresholds - "Good" requires 80+, not 70
  if (score >= 90) return { label: "Excellent", tone: "text-emerald-300" };
  if (score >= 80) return { label: "Good", tone: "text-sky-300" };
  if (score >= 65) return { label: "Fair", tone: "text-amber-300" };
  if (score >= 50) return { label: "Keep practicing", tone: "text-orange-300" };
  return { label: "Needs work", tone: "text-rose-300" };
}

function deriveTips(report: ScoreResult): string[] {
  const tips: string[] = [];
  if (report.score < 60) {
    tips.push("Slow down and pronounce each consonant clearly.");
  }
  if (report.wpm > 200) {
    tips.push("Reduce pace — aim for 130-160 wpm for clarity.");
  } else if (report.wpm > 0 && report.wpm < 80) {
    tips.push("Try to speak more fluidly — aim for 130-160 wpm.");
  }
  const weakWords = report.wordResults
    .filter((w) => typeof w.score === "number" && w.score < 80)  // Stricter: was 70
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 3)
    .map((w) => w.word);
  if (weakWords.length > 0) {
    tips.push(`Focus on these words: ${weakWords.join(", ")}.`);
  }
  tips.push("Practice 5-10 sentences in one session to build consistency.");
  return tips;
}

interface StatBlockProps {
  label: string;
  value: string;
  hint?: string;
}

function StatBlock({ label, value, hint }: StatBlockProps) {
  return (
    <div className="card-glass p-5">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums text-zinc-100">
        {value}
      </div>
      {hint ? <div className="text-xs text-zinc-500 mt-1">{hint}</div> : null}
    </div>
  );
}

export function ReportView({
  report,
  degraded,
  onTryAgain,
  onHome,
}: ReportViewProps) {
  const animatedScore = useCountUp(report.score, 800);
  const verdict = verdictFor(report.score);
  const tips = useMemo(() => deriveTips(report), [report]);

  const correctCount = report.wordResults.filter((w) => w.correct).length;
  const totalCount = report.wordResults.length;

  return (
    <div key="report" className="animate-fade-in-up space-y-6">
      {degraded && (
        <div className="card-glass px-4 py-3 text-xs text-amber-300 border-amber-500/40 flex items-center gap-2">
          <Lightbulb className="w-4 h-4" />
          Full report not available for older sessions. Showing summary only.
        </div>
      )}

      {/* Hero */}
      <section className="card-glass p-8 md:p-10 relative overflow-hidden">
        <div className="absolute -top-40 -right-32 w-[28rem] h-[28rem] rounded-full bg-brand-600/15 blur-3xl pointer-events-none" />
        <div className="relative grid md:grid-cols-[1fr_auto] gap-6 items-center">
          <div className="space-y-4">
            <span className="chip-brand">
              <Trophy className="w-3 h-3" />
              Pronunciation Score
            </span>
            <div className="relative inline-block">
              <div
                aria-hidden="true"
                className="absolute inset-0 blur-3xl opacity-50 gradient-text-score select-none text-9xl font-black tracking-tighter"
                style={{ transform: "translateZ(0)" }}
              >
                {Math.round(animatedScore)}
              </div>
              <div className="relative text-8xl md:text-9xl font-black tracking-tighter leading-none gradient-text-score tabular-nums">
                {Math.round(animatedScore)}
              </div>
            </div>
            <div className={`text-xl font-semibold ${verdict.tone}`}>
              {verdict.label}
            </div>
            {!report.available && (
              <div className="text-xs text-amber-300/90">
                Pronunciation engine unavailable — score derived from transcript match.
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={onTryAgain} className="btn-primary">
              <Repeat className="w-4 h-4" />
              Try Again
              <ArrowRight className="w-4 h-4 -mr-1" />
            </button>
            <button type="button" onClick={onHome} className="btn-ghost">
              <Home className="w-4 h-4" />
              Home
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBlock
          label="WPM"
          value={report.wpm > 0 ? Math.round(report.wpm).toString() : "—"}
          hint="Words per minute"
        />
        <StatBlock
          label="Duration"
          value={
            report.durationSeconds > 0
              ? `${report.durationSeconds.toFixed(1)}s`
              : "—"
          }
          hint="Speech length"
        />
        <StatBlock
          label="Words"
          value={`${correctCount}/${totalCount || "—"}`}
          hint="Correct / total"
        />
        <StatBlock
          label="Difficulty"
          value={report.difficulty.toUpperCase()}
          hint={
            typeof report.clarityScore === "number"
              ? `Clarity ${Math.round(report.clarityScore)}`
              : undefined
          }
        />
      </section>

      {/* Word-by-word analysis */}
      {report.wordResults.length > 0 && (
        <section className="card-glass p-6 md:p-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-zinc-100 tracking-tight">
              Word-by-Word Analysis
            </h3>
            <span className="text-xs text-zinc-500">
              Click a word for details
            </span>
          </div>
          <div className="flex flex-wrap gap-2 items-start">
            {report.wordResults.map((wordResult, index) => (
              <WordPill
                key={`${wordResult.word}-${index}`}
                result={wordResult}
                index={index}
              />
            ))}
          </div>
          {report.transcript && (
            <div className="mt-6 border-t border-zinc-800/60 pt-4">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
                Heard
              </div>
              <p className="text-zinc-400 italic leading-relaxed">
                “{report.transcript}”
              </p>
            </div>
          )}
        </section>
      )}

      {/* Tips */}
      {tips.length > 0 && (
        <section className="card-glass p-6 md:p-8">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-amber-300" />
            <h3 className="text-lg font-bold text-zinc-100 tracking-tight">
              Practice tips
            </h3>
          </div>
          <ul className="space-y-3">
            {tips.map((tip, index) => (
              <li
                key={index}
                className="border-l-2 border-brand-500/70 pl-3 text-sm text-zinc-300 leading-relaxed animate-fade-in-up"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                {tip}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
