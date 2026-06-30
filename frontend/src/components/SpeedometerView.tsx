import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Gauge, Info } from "lucide-react";
import { PASSAGES } from "../data/passages";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useWpm } from "../hooks/useWpm";
import { usePassageMatch } from "../hooks/usePassageMatch";
import { PassagePicker } from "./speedometer/PassagePicker";
import { ReadingPanel } from "./speedometer/ReadingPanel";
import { SpeedometerGauge } from "./speedometer/SpeedometerGauge";
import { ZoneIndicator } from "./speedometer/ZoneIndicator";
import { PaceControls } from "./speedometer/PaceControls";
import { PaceStats } from "./speedometer/PaceStats";

interface SpeedometerViewProps {
  onBack: () => void;
}

export function SpeedometerView({ onBack }: SpeedometerViewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");

  const passageText =
    selectedIndex !== null ? PASSAGES[selectedIndex]?.text ?? "" : "";

  const {
    tokens,
    statuses,
    matchedCount,
    progressPct,
    accuracyPct,
    advance,
    reset: resetMatch,
  } = usePassageMatch(passageText);

  // Refs so the recognition callback stays stable even though we mount the
  // recognition hook before useWpm exposes addWords.
  const addWordsRef = useRef<((words: string[]) => void) | null>(null);
  const advanceRef = useRef(advance);
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  advanceRef.current = advance;

  const handleResult = useCallback(
    ({ newWords, interim: interimText }: { newWords: string[]; interim: string }) => {
      if (newWords.length > 0) {
        addWordsRef.current?.(newWords);
        if (selectedRef.current !== null) {
          advanceRef.current?.(newWords);
        }
        setTranscript((prev) => `${prev}${newWords.join(" ")} `);
      }
      setInterim(interimText);
    },
    [],
  );

  const { isSupported, isListening, error, start, stop } = useSpeechRecognition({
    onResult: handleResult,
  });
  const { currentWpm, totalWords, elapsedSecs, avgWpm, addWords, reset: resetWpm } =
    useWpm(isListening);
  addWordsRef.current = addWords;

  const displayWpm = isListening ? currentWpm : avgWpm;

  const clearSession = useCallback(() => {
    resetWpm();
    resetMatch();
    setTranscript("");
    setInterim("");
  }, [resetWpm, resetMatch]);

  const handleSelect = useCallback(
    (idx: number) => {
      if (isListening) stop();
      setSelectedIndex(idx);
      clearSession();
    },
    [isListening, stop, clearSession],
  );

  const handleToggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  const handleReset = useCallback(() => {
    if (isListening) stop();
    clearSession();
  }, [isListening, stop, clearSession]);

  const passageSelected = selectedIndex !== null;

  return (
    <div key="speedometer" className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2"
          aria-label="Back to main menu"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full">
          <Gauge className="w-3.5 h-3.5" />
          <span>Phase 2 · Live</span>
        </div>
      </div>

      <header className="card-glass relative overflow-hidden p-6 md:p-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/30 via-cyan-500/15 to-transparent blur-3xl"
        />
        <div className="relative">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Voice{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-cyan-400 to-brand-400 animate-gradient-shift bg-[length:200%_200%]">
              CruiseControl
            </span>
          </h1>
          <p className="mt-2 text-zinc-400 text-sm md:text-base max-w-2xl leading-relaxed">
            Pick a paragraph, read aloud, and watch your live speaking pace move
            the needle. The green zone is{" "}
            <span className="text-emerald-300 font-medium">120–160 wpm</span> —
            the sweet spot for clear, confident speech.
          </p>
        </div>
      </header>

      <section className="card-glass p-6 md:p-7">
        <div className="text-[10px] uppercase tracking-widest text-zinc-400 mb-3">
          Choose a paragraph
        </div>
        <PassagePicker
          passages={PASSAGES}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <section className="card-glass p-6 md:p-7 lg:col-span-3 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-zinc-400">
            Read aloud
          </div>
          <ReadingPanel
            tokens={tokens}
            statuses={statuses}
            matchedCount={matchedCount}
            progressPct={progressPct}
            passageKey={selectedIndex}
          />
        </section>

        <section className="card-glass p-6 md:p-7 lg:col-span-2 flex flex-col items-center gap-4">
          <SpeedometerGauge
            wpm={displayWpm}
            isAverage={!isListening && avgWpm > 0}
          />
          <ZoneIndicator wpm={displayWpm} />
          <PaceControls
            isListening={isListening}
            canStart={isSupported && passageSelected}
            onToggle={handleToggle}
            onReset={handleReset}
          />
          {!passageSelected && (
            <p className="text-xs text-zinc-500 text-center">
              Select a paragraph above to enable the mic.
            </p>
          )}
        </section>
      </div>

      <PaceStats
        totalWords={totalWords}
        elapsedSecs={elapsedSecs}
        avgWpm={avgWpm}
        accuracyPct={accuracyPct}
      />

      <section className="card-glass p-5 md:p-6">
        <div className="text-[10px] uppercase tracking-widest text-zinc-400 mb-2">
          Transcript
        </div>
        <div
          aria-live="polite"
          className="min-h-[3rem] text-sm text-zinc-300 leading-relaxed"
        >
          {transcript || interim ? (
            <>
              <span>{transcript}</span>
              <span className="text-zinc-500 italic">{interim}</span>
            </>
          ) : (
            <span className="text-zinc-600 italic">
              Your speech will appear here…
            </span>
          )}
        </div>
      </section>

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isSupported && (
        <div className="card-glass border-amber-500/40 px-4 py-3 flex items-start gap-3 text-sm text-amber-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Your browser doesn't support the Web Speech API. Use Chrome, Edge,
            or Safari for live pace tracking.
          </span>
        </div>
      )}
    </div>
  );
}
