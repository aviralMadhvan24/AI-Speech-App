import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  Home,
  Lightbulb,
  Loader2,
  Swords,
  User,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { PlayerRole, PlayerScore, RoomState } from "../battleApi";
import { useBattleSocket } from "../hooks/useBattleSocket";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { getCurrentIdToken } from "../hooks/useAuth";
import { AudioVisualizer } from "./AudioVisualizer";
import { MicButton } from "./MicButton";

interface BattleRoomViewProps {
  roomCode: string;
  playerId: string;
  role: PlayerRole;
  /** Initial state from the create/join response — used until WS connects. */
  initialState: RoomState | null;
  onComplete: (finalState: RoomState) => void;
  onLeave: () => void;
}

interface AnalyzeWire {
  analysis_id: string;
  pronunciation?: { overall_score?: number | null };
  fluency?: { clarity_score?: number | null; words_per_minute?: number | null };
}

async function analyzeRecording(
  audio: Blob,
  expectedText: string,
): Promise<PlayerScore> {
  const bare = (audio.type || "").split(";")[0]?.trim().toLowerCase();
  const { mime, ext } = pickUploadMime(bare);
  const cleaned = new Blob([audio], { type: mime });

  const formData = new FormData();
  formData.append("file", cleaned, `battle.${ext}`);
  formData.append("expected_text", expectedText);

  // Attach the Firebase ID token — /analyze requires auth (401 without it).
  const headers = new Headers();
  const token = await getCurrentIdToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch("/analyze", {
    method: "POST",
    body: formData,
    headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Scoring failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const wire = (await response.json()) as AnalyzeWire;
  return {
    analysis_id: wire.analysis_id,
    pronunciation_score: Number(wire.pronunciation?.overall_score ?? 0),
    clarity_score: Number(wire.fluency?.clarity_score ?? 0),
    pace_wpm: Number(wire.fluency?.words_per_minute ?? 0),
  };
}

function pickUploadMime(bare: string): { mime: string; ext: string } {
  switch (bare) {
    case "audio/webm":
      return { mime: "audio/webm", ext: "webm" };
    case "audio/ogg":
      return { mime: "audio/ogg", ext: "ogg" };
    case "audio/mp4":
      return { mime: "audio/mp4", ext: "m4a" };
    case "audio/mpeg":
    case "audio/mp3":
      return { mime: "audio/mpeg", ext: "mp3" };
    case "audio/wav":
    case "audio/x-wav":
      return { mime: "audio/wav", ext: "wav" };
    default:
      return { mime: "audio/webm", ext: "webm" };
  }
}

function PlayerCard({
  name,
  isHost,
  isYou,
  isReady,
  scoreSubmitted,
  muted,
}: {
  name: string;
  isHost: boolean;
  isYou: boolean;
  isReady?: boolean;
  scoreSubmitted?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        "card-glass p-4 flex items-center gap-3",
        muted ? "opacity-60" : "",
        isYou ? "border-brand-500/40 ring-1 ring-brand-500/30" : "",
      ].join(" ")}
    >
      <div
        className={[
          "w-10 h-10 rounded-full flex items-center justify-center",
          isHost ? "bg-amber-500/15 text-amber-300" : "bg-cyan-500/15 text-cyan-300",
        ].join(" ")}
      >
        {isHost ? <Crown className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100 truncate">{name}</span>
          {isYou && (
            <span className="text-[10px] uppercase tracking-widest text-brand-300 font-semibold">
              You
            </span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          {isHost ? "Host" : "Opponent"}
        </div>
      </div>
      {scoreSubmitted ? (
        <span className="chip-emerald">
          <Check className="w-3 h-3" />
          Scored
        </span>
      ) : isReady ? (
        <span className="chip-emerald">
          <Check className="w-3 h-3" />
          Ready
        </span>
      ) : (
        <span className="chip-zinc">Waiting</span>
      )}
    </div>
  );
}

function CountdownNumber({ value }: { value: number | "GO" }) {
  return (
    <div
      key={String(value)}
      className="text-[10rem] md:text-[14rem] font-black leading-none tabular-nums animate-scale-in gradient-text"
    >
      {value}
    </div>
  );
}

export function BattleRoomView({
  roomCode,
  playerId,
  role,
  initialState,
  onComplete,
  onLeave,
}: BattleRoomViewProps) {
  const { state: liveState, connected, error: socketError, sendReady, sendScore } =
    useBattleSocket(roomCode, playerId);

  const state = liveState ?? initialState;
  const recorder = useAudioRecorder();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const autoStopRef = useRef(false);

  // Ticking clock for synced countdown / recording timers.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 200);
    return () => window.clearInterval(id);
  }, []);

  // Reset per-round state when status moves back to a pre-record phase.
  useEffect(() => {
    if (!state) return;
    if (state.status === "waiting" || state.status === "ready") {
      setScoreSubmitted(false);
      setSubmitError(null);
      autoStopRef.current = false;
    }
  }, [state?.status]);

  // Bubble up when the round completes.
  useEffect(() => {
    if (state && state.status === "complete") {
      onComplete(state);
    }
  }, [state, onComplete]);

  const status = state?.status ?? "waiting";
  const prompt = state?.prompt;
  const hostName = state?.host_name ?? "Host";
  const opponentName = state?.opponent_name ?? null;
  const youAre = role;
  const opponentRole: PlayerRole = role === "host" ? "opponent" : "host";

  const yourScoreSubmitted =
    !!state?.scores && !!(role === "host" ? state.scores.host : state.scores.opponent);
  const oppScoreSubmitted =
    !!state?.scores && !!(role === "host" ? state.scores.opponent : state.scores.host);

  const handleScoreUpload = useCallback(
    async (blob: Blob) => {
      if (!prompt) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const score = await analyzeRecording(blob, prompt.text);
        sendScore(score);
        setScoreSubmitted(true);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Scoring failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [prompt, sendScore],
  );

  // Auto-start recording when server flips to "recording", auto-stop when the
  // server deadline passes.
  useEffect(() => {
    if (status !== "recording") return;
    if (recorder.isRecording || scoreSubmitted || submitting) return;
    if (recorder.audioBlob) return;
    void recorder.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status !== "recording") return;
    if (!state?.phase_deadline) return;
    if (!recorder.isRecording) return;
    if (autoStopRef.current) return;
    if (now >= state.phase_deadline) {
      autoStopRef.current = true;
      void (async () => {
        const blob = await recorder.stop();
        if (blob && blob.size > 0) {
          await handleScoreUpload(blob);
        }
      })();
    }
  }, [now, state?.phase_deadline, status, recorder, handleScoreUpload]);

  const handleManualStop = async () => {
    if (!recorder.isRecording || submitting || scoreSubmitted) return;
    autoStopRef.current = true;
    const blob = await recorder.stop();
    if (blob && blob.size > 0) {
      await handleScoreUpload(blob);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // Some browsers reject clipboard without user gesture; ignore.
    }
  };

  const countdownDisplay = useMemo<number | "GO" | null>(() => {
    if (status !== "countdown" || !state?.phase_deadline) return null;
    const remaining = Math.max(0, state.phase_deadline - now);
    if (remaining <= 0.2) return "GO";
    return Math.max(1, Math.ceil(remaining));
  }, [now, state?.phase_deadline, status]);

  const recordingRemaining = useMemo(() => {
    if (status !== "recording" || !state?.phase_deadline) return null;
    return Math.max(0, state.phase_deadline - now);
  }, [now, state?.phase_deadline, status]);

  const banner = (
    <section className="card-glass p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="chip bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/30">
          <Swords className="w-3 h-3" />
          1v1 Battle
        </span>
        <span className="text-zinc-500 text-sm">
          Room <span className="font-mono text-zinc-300">{roomCode}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={connected ? "text-emerald-300" : "text-zinc-500"}>
          {connected ? (
            <Wifi className="w-3.5 h-3.5 inline" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 inline" />
          )}
          <span className="ml-1">{connected ? "Connected" : "Connecting…"}</span>
        </span>
        <button type="button" onClick={onLeave} className="btn-ghost px-3 py-1.5">
          <Home className="w-3.5 h-3.5" />
          Leave
        </button>
      </div>
    </section>
  );

  const playerRow = state && (
    <div className="grid sm:grid-cols-2 gap-3">
      <PlayerCard
        name={hostName}
        isHost={true}
        isYou={youAre === "host"}
        isReady={state.host_ready}
        scoreSubmitted={!!state.scores?.host}
      />
      <PlayerCard
        name={opponentName ?? "Waiting for opponent…"}
        isHost={false}
        isYou={youAre === "opponent"}
        isReady={state.opponent_ready}
        scoreSubmitted={!!state.scores?.opponent}
        muted={!opponentName}
      />
    </div>
  );

  // ----- Per-status content -----

  let content: React.ReactNode = null;

  if (status === "waiting") {
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-6 text-center">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Share this code with your opponent
        </div>
        <div className="flex items-center gap-3">
          <div className="text-5xl md:text-6xl font-mono font-bold tracking-[0.35em] gradient-text">
            {roomCode}
          </div>
          <button
            type="button"
            onClick={handleCopyCode}
            className="btn-ghost"
            aria-label="Copy room code"
          >
            {codeCopied ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Waiting for opponent to join…
        </div>
      </section>
    );
  } else if (status === "ready") {
    const youReady = role === "host" ? state?.host_ready : state?.opponent_ready;
    content = (
      <section className="card-glass p-8 md:p-10 flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Read this aloud when the timer starts
          </div>
          <p className="text-2xl md:text-3xl font-bold text-zinc-100 leading-snug tracking-tight max-w-2xl">
            {prompt?.text ?? "Loading prompt…"}
          </p>
          {prompt?.hint && (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200 px-3 py-1 text-xs">
              <Lightbulb className="w-3 h-3" />
              {prompt.hint}
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={sendReady}
            disabled={youReady}
            className="btn-primary px-6 py-3 text-base"
          >
            {youReady ? (
              <>
                <Check className="w-4 h-4" strokeWidth={2.6} />
                You're ready
              </>
            ) : (
              <>
                <Check className="w-4 h-4" strokeWidth={2.6} />
                I'm Ready
              </>
            )}
          </button>
          <div className="text-xs text-zinc-500">
            Both players need to click ready to start.
          </div>
        </div>
      </section>
    );
  } else if (status === "countdown") {
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-6 min-h-[24rem] justify-center">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Get ready…
        </div>
        {countdownDisplay != null && <CountdownNumber value={countdownDisplay} />}
        <p className="text-zinc-400 text-sm max-w-md text-center">
          {prompt?.text}
        </p>
      </section>
    );
  } else if (status === "recording" || status === "scoring") {
    const seconds = recordingRemaining ?? 0;
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-6">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Record now — same prompt, both players
        </div>
        <p className="text-2xl md:text-3xl font-bold text-zinc-100 leading-snug tracking-tight max-w-2xl text-center">
          {prompt?.text}
        </p>
        <div
          className={[
            "font-mono text-4xl tabular-nums font-bold",
            seconds <= 10 ? "text-rose-300" : "text-zinc-200",
          ].join(" ")}
        >
          {mm}:{ss}
        </div>
        <AudioVisualizer
          stream={recorder.stream}
          isRecording={recorder.isRecording}
        />
        <MicButton
          isRecording={recorder.isRecording}
          onClick={handleManualStop}
          disabled={submitting || scoreSubmitted || !recorder.isRecording}
        />
        <div className="text-xs text-zinc-500 text-center max-w-md min-h-[1.5em]">
          {submitError ? (
            <span className="text-rose-300">{submitError}</span>
          ) : submitting ? (
            "Uploading and scoring your recording…"
          ) : scoreSubmitted ? (
            yourScoreSubmitted && !oppScoreSubmitted
              ? "Submitted. Waiting for opponent to finish…"
              : "Submitted."
          ) : recorder.isRecording ? (
            "Tap the stop button when you're done. Auto-stops at 0:00."
          ) : recorder.error ? (
            <span className="text-rose-300">{recorder.error}</span>
          ) : (
            "Starting microphone…"
          )}
        </div>
        {(yourScoreSubmitted || oppScoreSubmitted) && (
          <div className="flex gap-3 text-xs text-zinc-500">
            <span className={yourScoreSubmitted ? "text-emerald-300" : ""}>
              You: {yourScoreSubmitted ? "✓" : "…"}
            </span>
            <span className={oppScoreSubmitted ? "text-emerald-300" : ""}>
              Opponent: {oppScoreSubmitted ? "✓" : "…"}
            </span>
          </div>
        )}
      </section>
    );
  } else if (status === "abandoned") {
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-4 text-center">
        <div className="text-rose-300 text-lg font-semibold">
          {state?.error === "opponent_disconnected"
            ? "Your opponent left the battle."
            : "The battle was abandoned."}
        </div>
        <button type="button" onClick={onLeave} className="btn-primary">
          <Home className="w-4 h-4" />
          Back to Home
        </button>
      </section>
    );
  } else if (status === "complete") {
    // The parent navigates away; render a brief stub.
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-4 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-brand-300" />
        <div className="text-zinc-300">Round complete — tallying results…</div>
      </section>
    );
  }

  // Suppress unused-variable warning for opponentRole (kept for clarity).
  void opponentRole;

  return (
    <div key="battle-room" className="animate-fade-in-up space-y-6">
      {banner}
      {playerRow}
      {socketError && status !== "abandoned" && status !== "complete" && (
        <div className="card-glass px-4 py-3 text-sm text-amber-200 border-amber-500/40">
          {socketError}
        </div>
      )}
      {content}
    </div>
  );
}
