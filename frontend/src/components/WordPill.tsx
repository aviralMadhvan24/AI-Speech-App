import { useState } from "react";
import { ChevronDown, ChevronUp, Volume2 } from "lucide-react";
import type { WordResult } from "../types";

interface WordPillProps {
  result: WordResult;
  index: number;
}

// Human-readable phoneme names for common ARPAbet symbols
const PHONEME_NAMES: Record<string, string> = {
  // Vowels
  AA: "ah (as in father)",
  AE: "a (as in cat)",
  AH: "uh (as in but)",
  AO: "aw (as in dog)",
  AW: "ow (as in cow)",
  AY: "eye (as in my)",
  EH: "eh (as in bed)",
  ER: "er (as in bird)",
  EY: "ay (as in say)",
  IH: "ih (as in sit)",
  IY: "ee (as in see)",
  OW: "oh (as in go)",
  OY: "oy (as in boy)",
  UH: "uh (as in book)",
  UW: "oo (as in food)",
  // Consonants
  B: "b",
  CH: "ch (as in chin)",
  D: "d",
  DH: "th (as in this)",
  F: "f",
  G: "g (hard)",
  HH: "h",
  JH: "j (as in judge)",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ng (as in sing)",
  P: "p",
  R: "r",
  S: "s",
  SH: "sh (as in she)",
  T: "t",
  TH: "th (as in think)",
  V: "v",
  W: "w",
  Y: "y",
  Z: "z",
  ZH: "zh (as in measure)",
};

function formatPhoneme(p: string): string {
  // Strip stress markers (0, 1, 2) for display
  const clean = p.replace(/[012]/g, "").toUpperCase();
  return PHONEME_NAMES[clean] || p;
}

function PhonemeChip({ phoneme, variant }: { phoneme: string; variant: "expected" | "observed" }) {
  const clean = phoneme.replace(/[012]/g, "").toUpperCase();
  return (
    <span
      title={formatPhoneme(phoneme)}
      className={[
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-mono",
        variant === "expected"
          ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
          : "bg-amber-500/20 text-amber-300 border border-amber-500/30",
      ].join(" ")}
    >
      {clean}
    </span>
  );
}

export function WordPill({ result, index }: WordPillProps) {
  const [expanded, setExpanded] = useState(false);
  const isCorrect = result.correct;
  const hasPhonemes = 
    (result.expectedPhonemes && result.expectedPhonemes.length > 0) ||
    (result.observedPhonemes && result.observedPhonemes.length > 0);

  const scoreLabel = typeof result.score === "number" 
    ? `${Math.round(result.score)}/100` 
    : null;

  return (
    <div
      className={[
        "group inline-flex flex-col",
        "rounded-lg text-sm font-medium",
        "transition-all duration-200 ease-out",
        "animate-fade-in-up",
        expanded ? "w-full md:w-auto" : "",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index, 60) * 60}ms` }}
    >
      {/* Main pill - clickable */}
      <button
        type="button"
        onClick={() => hasPhonemes && setExpanded(!expanded)}
        className={[
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg",
          "transition-transform duration-150 ease-out",
          hasPhonemes ? "hover:scale-105 cursor-pointer" : "cursor-default",
          isCorrect
            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
            : "bg-rose-500/10 border border-rose-500/30 text-rose-300",
        ].join(" ")}
      >
        <span className={isCorrect ? "" : "line-through decoration-rose-400/60"}>
          {result.word}
        </span>
        {scoreLabel && (
          <span className="text-[10px] opacity-70 font-normal">
            {scoreLabel}
          </span>
        )}
        {hasPhonemes && (
          <span className="text-[10px] opacity-50">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        )}
      </button>

      {/* Heard word indicator */}
      {!isCorrect && result.heard && !expanded && (
        <span className="text-[10px] font-medium text-zinc-500 px-2.5 mt-0.5">
          heard: <span className="text-zinc-400">{result.heard}</span>
        </span>
      )}

      {/* Expanded details panel */}
      {expanded && hasPhonemes && (
        <div className="mt-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50 space-y-3 w-full">
          {/* Score and feedback */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-zinc-500" />
              <span className="text-xs text-zinc-400">Pronunciation Details</span>
            </div>
            {scoreLabel && (
              <span className={[
                "text-sm font-bold",
                (result.score ?? 0) >= 80 ? "text-emerald-400" : 
                (result.score ?? 0) >= 65 ? "text-amber-400" : "text-rose-400"
              ].join(" ")}>
                {scoreLabel}
              </span>
            )}
          </div>

          {/* Feedback text */}
          {result.feedback && (
            <p className="text-xs text-zinc-300 leading-relaxed border-l-2 border-brand-500/50 pl-2">
              {result.feedback}
            </p>
          )}

          {/* Heard different word */}
          {result.heard && (
            <div className="text-xs">
              <span className="text-zinc-500">Heard: </span>
              <span className="text-rose-300 font-medium">"{result.heard}"</span>
              <span className="text-zinc-500"> instead of </span>
              <span className="text-emerald-300 font-medium">"{result.word}"</span>
            </div>
          )}

          {/* Expected phonemes */}
          {result.expectedPhonemes && result.expectedPhonemes.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Expected Sounds
              </div>
              <div className="flex flex-wrap gap-1">
                {result.expectedPhonemes.map((p, i) => (
                  <PhonemeChip key={`exp-${i}`} phoneme={p} variant="expected" />
                ))}
              </div>
            </div>
          )}

          {/* Observed phonemes */}
          {result.observedPhonemes && result.observedPhonemes.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                What We Heard
              </div>
              <div className="flex flex-wrap gap-1">
                {result.observedPhonemes.map((p, i) => (
                  <PhonemeChip key={`obs-${i}`} phoneme={p} variant="observed" />
                ))}
              </div>
            </div>
          )}

          {/* Phoneme comparison hint */}
          {result.expectedPhonemes && result.observedPhonemes && (
            <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-700/50">
              💡 Hover over phoneme symbols to see how each sound is pronounced
            </div>
          )}
        </div>
      )}
    </div>
  );
}
