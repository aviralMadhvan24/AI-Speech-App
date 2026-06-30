import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  SkipForward,
} from "lucide-react";
import type { Difficulty, Sentence } from "../types";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { AudioVisualizer } from "./AudioVisualizer";
import { MicButton } from "./MicButton";

interface PracticeViewProps {
  sentences: Sentence[];
  difficulty: Difficulty;
  onChangeDifficulty: (next: Difficulty) => void;
  sentenceIndex: number;
  onChangeSentenceIndex: (nextIndex: number) => void;
  onSubmit: (audio: Blob, sentence: Sentence) => Promise<void>;
  onBack: () => void;
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds - mins * 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function PracticeView({
  sentences,
  difficulty,
  onChangeDifficulty,
  sentenceIndex,
  onChangeSentenceIndex,
  onSubmit,
  onBack,
}: PracticeViewProps) {
  const filtered = useMemo(
    () => sentences.filter((s) => s.difficulty === difficulty),
    [sentences, difficulty],
  );

  const sentence = filtered[sentenceIndex] ?? filtered[0] ?? null;
  const totalAtDifficulty = filtered.length;
  const positionLabel = totalAtDifficulty
    ? `${Math.min(sentenceIndex + 1, totalAtDifficulty)} of ${totalAtDifficulty}`
    : "0 of 0";

  const recorder = useAudioRecorder();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!recorder.isRecording) {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    setElapsed(0);
    const startedAt = performance.now();
    timerRef.current = window.setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 100);
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [recorder.isRecording]);

  // Reset timer when sentence changes.
  useEffect(() => {
    setElapsed(0);
    recorder.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence?.id]);

  const handleMicToggle = async () => {
    if (submitting) return;
    if (recorder.isRecording) {
      await recorder.stop();
    } else {
      await recorder.start();
    }
  };

  const goPrev = () => {
    if (sentenceIndex > 0) onChangeSentenceIndex(sentenceIndex - 1);
  };
  const goNext = () => {
    if (sentenceIndex < filtered.length - 1) {
      onChangeSentenceIndex(sentenceIndex + 1);
    }
  };

  // Keyboard navigation.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(event.target.tagName)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentenceIndex, filtered.length]);

  const handleSubmit = async () => {
    if (!sentence) return;
    let audio: Blob | null = recorder.audioBlob;
    if (recorder.isRecording) {
      audio = await recorder.stop();
    }
    if (!audio || audio.size === 0) {
      // Nothing to score yet.
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(audio, sentence);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!recorder.audioBlob && !recorder.isRecording && !submitting;

  return (
    <div key="practice" className="animate-fade-in-up space-y-6">
      {/* Difficulty picker */}
      <section className="card-glass p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="btn-ghost px-3 py-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-zinc-500 text-sm">Difficulty:</span>
          <div className="flex items-center gap-1 rounded-xl bg-zinc-900/60 border border-zinc-800 p-1">
            {DIFFICULTY_ORDER.map((level) => {
              const active = level === difficulty;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChangeDifficulty(level)}
                  className={[
                    "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
                    active
                      ? "bg-brand-500/20 text-brand-300 border border-brand-500/40 shadow-glow-sm"
                      : "text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip-zinc">Sentence {positionLabel}</span>
        </div>
      </section>

      {/* Main practice card */}
      <section className="card-glass p-8 md:p-12">
        <div className="flex flex-col items-center text-center gap-8">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Read this aloud
          </div>
          <div className="relative w-full max-w-3xl">
            <div className="absolute inset-0 -m-4 rounded-3xl bg-gradient-to-br from-brand-500/10 via-fuchsia-500/5 to-transparent blur-2xl pointer-events-none" />
            <p className="relative text-3xl md:text-4xl font-bold text-zinc-100 leading-snug tracking-tight">
              {sentence?.text ?? "No sentences available."}
            </p>
            {sentence?.focusWord && (
              <p className="relative mt-4 text-xs uppercase tracking-widest text-zinc-500">
                Focus word:{" "}
                <span className="text-brand-300 normal-case tracking-normal text-sm font-semibold">
                  {sentence.focusWord}
                </span>
              </p>
            )}
            {sentence?.hint && (
              <div className="relative mt-3 inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200 px-3 py-1 text-xs">
                <Lightbulb className="w-3 h-3" />
                {sentence.hint}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-4">
            <AudioVisualizer
              stream={recorder.stream}
              isRecording={recorder.isRecording}
            />
            <MicButton
              isRecording={recorder.isRecording}
              onClick={handleMicToggle}
              disabled={submitting || !sentence}
            />
            <div className="font-mono text-sm tabular-nums text-zinc-500">
              {formatTimer(elapsed)}
            </div>
            {recorder.error && (
              <div className="text-xs text-rose-400 max-w-sm">{recorder.error}</div>
            )}
            {!recorder.isRecording && recorder.audioBlob && (
              <div className="text-xs text-emerald-300">
                Recording ready. Hit “I'm Done” to score.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={goNext}
              disabled={sentenceIndex >= filtered.length - 1}
              className="btn-ghost"
            >
              <SkipForward className="w-4 h-4" />
              Skip
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || !sentence}
              className="btn-primary"
            >
              <Check className="w-4 h-4" strokeWidth={2.6} />
              {submitting ? "Scoring…" : "I'm Done"}
            </button>
          </div>
        </div>
      </section>

      {/* Prev/Next */}
      <section className="flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          disabled={sentenceIndex === 0}
          className="btn-ghost"
        >
          <ChevronLeft className="w-4 h-4" />
          Prev
        </button>
        <div className="text-xs text-zinc-500">
          Use ← / → to navigate
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={sentenceIndex >= filtered.length - 1}
          className="btn-ghost"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </section>
    </div>
  );
}

