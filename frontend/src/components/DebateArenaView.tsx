import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Home,
  Loader2,
  MessageSquareText,
  Mic,
  Pause,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  createDebateRoom,
  fetchMotions,
  flipReady,
  joinDebateRoom,
  uploadTurn,
  type MotionPublic,
  type ParticipantPublic,
  type TurnUploadResponse,
} from "../debateApi";
import { useDebateSocket } from "../hooks/useDebateSocket";
import { useAudioRecorder } from "../hooks/useAudioRecorder";

interface DebateArenaViewProps {
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSeconds(sec: number | null): string {
  if (sec == null) return "--:--";
  const clamped = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
  const ss = String(clamped % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function participantLabel(p: ParticipantPublic): string {
  return p.display_name || `Speaker ${p.turn_index + 1}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ParticipantChip({
  participant,
  isYou,
  isActive,
}: {
  participant: ParticipantPublic;
  isYou: boolean;
  isActive: boolean;
}) {
  return (
    <div
      className={[
        "card-glass px-3 py-2 flex items-center gap-2",
        isYou ? "border-brand-500/40 ring-1 ring-brand-500/30" : "",
        isActive ? "border-fuchsia-500/50 ring-1 ring-fuchsia-500/40" : "",
        participant.is_forfeit ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-semibold text-white">
        {participantLabel(participant).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-zinc-100 truncate">
          {participantLabel(participant)}
          {isYou && (
            <span className="ml-1.5 text-[9px] uppercase tracking-widest text-brand-300 font-semibold">
              You
            </span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">
          Speaker {participant.turn_index + 1}
          {participant.is_forfeit && " · Forfeit"}
        </div>
      </div>
      {participant.is_ready ? (
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

function CountdownBadge({
  seconds,
  label,
  danger,
}: {
  seconds: number | null;
  label: string;
  danger?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Clock
        className={`w-4 h-4 ${danger ? "text-rose-300" : "text-zinc-400"}`}
      />
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
        {label}
      </span>
      <span
        className={[
          "font-mono text-lg tabular-nums font-bold",
          danger ? "text-rose-300" : "text-zinc-100",
        ].join(" ")}
      >
        {formatSeconds(seconds)}
      </span>
    </div>
  );
}

function PausedOverlay({
  disconnectedName,
  reconnectRemaining,
}: {
  disconnectedName: string | null;
  reconnectRemaining: number | null;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm animate-fade-in-up">
      <div className="card-glass p-8 md:p-10 max-w-md text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <Pause className="w-6 h-6 text-amber-300" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-100">Debate paused</h2>
        <p className="text-sm text-zinc-400">
          {disconnectedName
            ? `${disconnectedName} disconnected. Waiting up to 30 seconds…`
            : "A participant disconnected. Waiting up to 30 seconds…"}
        </p>
        <div className="font-mono text-4xl tabular-nums font-bold text-amber-200">
          {formatSeconds(reconnectRemaining)}
        </div>
        <p className="text-xs text-zinc-500">
          The turn will resume as soon as they reconnect.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DebateArenaView({ onBack }: DebateArenaViewProps) {
  // ------- Local state -------
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [motions, setMotions] = useState<MotionPublic[]>([]);
  const [motionsError, setMotionsError] = useState<string | null>(null);
  const [readyBusy, setReadyBusy] = useState(false);
  const [uploadingTurn, setUploadingTurn] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastTurnResult, setLastTurnResult] =
    useState<TurnUploadResponse | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [codeCopied, setCodeCopied] = useState(false);

  const { state, connected, error: socketError } = useDebateSocket(
    roomCode,
    participantId,
  );
  const recorder = useAudioRecorder();
  const autoUploadRef = useRef(false);

  // ------- Load motions for the lobby -------
  useEffect(() => {
    let cancelled = false;
    fetchMotions()
      .then((list) => {
        if (!cancelled) setMotions(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMotionsError(
            err instanceof Error ? err.message : "Could not load motions.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------- Ticking clock (drives every countdown) -------
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 500);
    return () => window.clearInterval(id);
  }, []);

  // ------- Derived data -------
  const myParticipant = useMemo<ParticipantPublic | null>(() => {
    if (!state || !participantId) return null;
    return (
      state.participants.find((p) => p.participant_id === participantId) ?? null
    );
  }, [state, participantId]);

  const isMyTurn = !!(
    state &&
    myParticipant &&
    typeof state.active_turn_index === "number" &&
    state.active_turn_index === myParticipant.turn_index
  );

  const activeSpeaker = useMemo<ParticipantPublic | null>(() => {
    if (!state || typeof state.active_turn_index !== "number") return null;
    return (
      state.participants.find(
        (p) => p.turn_index === state.active_turn_index,
      ) ?? null
    );
  }, [state]);

  const prepRemaining = state?.prep_deadline
    ? Math.max(0, state.prep_deadline - now)
    : null;
  const turnRemaining = state?.turn_deadline
    ? Math.max(0, state.turn_deadline - now)
    : null;
  const reconnectRemaining = state?.reconnect_deadline
    ? Math.max(0, state.reconnect_deadline - now)
    : null;

  const disconnectedName = useMemo<string | null>(() => {
    // Best-effort: we don't get disconnected_at on public state, so any
    // known participant who is currently "paused" is a candidate. The
    // active speaker is the most likely stall — surface their name if
    // we know it, else fall back to a generic phrasing.
    if (!state?.paused) return null;
    return activeSpeaker ? participantLabel(activeSpeaker) : null;
  }, [state?.paused, activeSpeaker]);

  const readyCount = useMemo(
    () => state?.participants.filter((p) => p.is_ready).length ?? 0,
    [state],
  );
  const totalParticipants = state?.participants.length ?? 0;

  const winner = useMemo<ParticipantPublic | null>(() => {
    if (!state?.winner_participant_id) return null;
    return (
      state.participants.find(
        (p) => p.participant_id === state.winner_participant_id,
      ) ?? null
    );
  }, [state]);

  // ------- Upload helper -------
  const handleUploadTurn = useCallback(
    async (blob: Blob) => {
      if (!roomCode) return;
      setUploadingTurn(true);
      setUploadError(null);
      try {
        const result = await uploadTurn(roomCode, blob);
        setLastTurnResult(result);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Turn upload failed.",
        );
      } finally {
        setUploadingTurn(false);
      }
    },
    [roomCode],
  );

  // ------- Auto-start recorder when it's my turn to speak -------
  useEffect(() => {
    if (!state) return;
    if (state.state !== "speaking") return;
    if (state.paused) return;
    if (!isMyTurn) return;
    if (recorder.isRecording) return;
    if (uploadingTurn) return;
    // Don't check audioBlob - it may be stale from a previous turn
    // Reset it here before starting fresh
    recorder.reset();
    autoUploadRef.current = false;
    
    // Small delay to ensure DOM and state are fully settled
    const startTimer = setTimeout(() => {
      if (!recorder.isRecording) {
        void recorder.start();
      }
    }, 50);
    
    return () => clearTimeout(startTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.state, state?.paused, isMyTurn, state?.active_turn_index]);

  // ------- Safety net: stop recorder if we leave speaking -------
  useEffect(() => {
    if (
      state &&
      state.state !== "speaking" &&
      recorder.isRecording
    ) {
      void recorder.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.state]);

  // ------- Auto-stop + upload when the turn deadline expires -------
  useEffect(() => {
    if (!state) return;
    if (state.state !== "speaking") return;
    if (state.paused) return;
    if (!isMyTurn) return;
    if (!state.turn_deadline) return;
    if (!recorder.isRecording) return;
    if (autoUploadRef.current) return;
    if (now >= state.turn_deadline) {
      autoUploadRef.current = true;
      void (async () => {
        const blob = await recorder.stop();
        if (blob && blob.size > 0) {
          await handleUploadTurn(blob);
        }
      })();
    }
  }, [now, state, isMyTurn, recorder, handleUploadTurn]);

  // Clear per-turn state when the active turn changes.
  // IMPORTANT: Only reset for participants who are NOT the new active speaker,
  // otherwise we break their recording before it starts.
  useEffect(() => {
    // Skip reset if I'm the new active speaker - let auto-start handle it
    if (isMyTurn) {
      // Just clear the upload ref, don't reset recorder
      autoUploadRef.current = false;
      setUploadError(null);
      return;
    }
    // For non-active speakers, fully reset state
    autoUploadRef.current = false;
    setUploadError(null);
    setLastTurnResult(null);
    recorder.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.active_turn_index, isMyTurn]);

  // ------- Lobby handlers -------
  const handleCreateRoom = useCallback(async () => {
    setCreating(true);
    setJoinError(null);
    try {
      const response = await createDebateRoom();
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : "Could not create room.",
      );
    } finally {
      setCreating(false);
    }
  }, []);

  const handleJoinRoom = useCallback(async () => {
    const cleaned = joinCodeInput.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(cleaned)) {
      setJoinError(
        "Enter a valid 6-character code (letters and digits, no O/0/I/1).",
      );
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const response = await joinDebateRoom(cleaned);
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join room.");
    } finally {
      setJoining(false);
    }
  }, [joinCodeInput]);

  const handleFlipReady = useCallback(async () => {
    if (!roomCode) return;
    setReadyBusy(true);
    setJoinError(null);
    try {
      await flipReady(roomCode);
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : "Could not update ready state.",
      );
    } finally {
      setReadyBusy(false);
    }
  }, [roomCode]);

  const handleLeave = useCallback(() => {
    if (recorder.isRecording) {
      void recorder.stop();
    }
    setRoomCode(null);
    setParticipantId(null);
    setLastTurnResult(null);
    setUploadError(null);
    setJoinError(null);
    setJoinCodeInput("");
    autoUploadRef.current = false;
    onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack]);

  const handleManualStop = useCallback(async () => {
    // Early return checks with better logging
    if (uploadingTurn) {
      console.log('[Debate] handleManualStop: already uploading, skipping');
      return;
    }
    if (autoUploadRef.current) {
      console.log('[Debate] handleManualStop: auto-upload already triggered, skipping');
      return;
    }
    if (!recorder.isRecording) {
      console.log('[Debate] handleManualStop: not recording, checking for existing blob');
      // If we have a blob from a previous stop, try uploading it
      if (recorder.audioBlob && recorder.audioBlob.size > 0) {
        autoUploadRef.current = true;
        await handleUploadTurn(recorder.audioBlob);
      }
      return;
    }
    
    console.log('[Debate] handleManualStop: stopping recording and uploading');
    autoUploadRef.current = true;
    try {
      const blob = await recorder.stop();
      if (blob && blob.size > 0) {
        await handleUploadTurn(blob);
      } else {
        setUploadError("Recording produced no audio. Please try again.");
        autoUploadRef.current = false;
      }
    } catch (err) {
      console.error('[Debate] handleManualStop error:', err);
      setUploadError(err instanceof Error ? err.message : "Failed to stop recording");
      autoUploadRef.current = false;
    }
  }, [recorder, uploadingTurn, handleUploadTurn]);

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // clipboard may be blocked; ignore silently
    }
  };

  // -------------------------------------------------------------------------
  // Render: Lobby (before joining any room)
  // -------------------------------------------------------------------------
  if (!roomCode || !participantId) {
    return (
      <div key="debate-lobby" className="space-y-5 animate-fade-in-up">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            aria-label="Back to main menu"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-violet-300 bg-violet-500/10 border border-violet-500/30 px-3 py-1 rounded-full">
            <MessageSquareText className="w-3.5 h-3.5" />
            <span>Group Debate · Live</span>
          </div>
        </div>

        <header className="card-glass relative overflow-hidden p-6 md:p-8">
          <div
            aria-hidden
            className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-transparent blur-3xl"
          />
          <div className="relative">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Group{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-300 via-fuchsia-400 to-pink-400 animate-gradient-shift bg-[length:200%_200%]">
                Debate
              </span>
            </h1>
            <p className="mt-2 text-zinc-400 text-sm md:text-base max-w-2xl leading-relaxed">
              Live debate with 4-6 participants. One motion, one turn each (120s), AI-scored.
              Highest effective score wins.
            </p>
          </div>
        </header>

        {joinError && (
          <div className="card-glass border-rose-500/40 px-4 py-3 text-sm text-rose-300">
            {joinError}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          <div className="card-glass p-6 md:p-7 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-glow-sm flex items-center justify-center">
                <MessageSquareText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">
                  Create room
                </h2>
                <p className="text-xs text-zinc-500">
                  Create a new room and share the code.
                </p>
              </div>
            </div>
            <p className="text-sm text-zinc-400">
              A random motion will be assigned when you create the room. Wait for
              at least 3 more players — debate auto-starts when all are ready.
            </p>
            <button
              type="button"
              onClick={handleCreateRoom}
              disabled={creating}
              className="btn-primary w-full py-3"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <MessageSquareText className="w-4 h-4" />
                  Create Debate Room
                </>
              )}
            </button>
          </div>

          <div className="card-glass p-6 md:p-7 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-brand-500 shadow-glow-sm flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">
                  Join by code
                </h2>
                <p className="text-xs text-zinc-500">
                  Enter your friend's 6-character room code.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={joinCodeInput}
              onChange={(e) => {
                const cleaned = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 6);
                setJoinCodeInput(cleaned);
              }}
              placeholder="ABC234"
              autoCapitalize="characters"
              maxLength={6}
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] uppercase text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
              aria-label="Debate room code"
            />
            <button
              type="button"
              onClick={handleJoinRoom}
              disabled={joining || joinCodeInput.length !== 6}
              className="btn-primary w-full py-3"
            >
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Joining…
                </>
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Join
                </>
              )}
            </button>
          </div>
        </section>

        <section className="card-glass p-6 md:p-7 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">
              Available motions
            </h2>
            <span className="text-xs text-zinc-500 tabular-nums">
              {motions.length} total
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            A random motion is assigned on room creation. Preview below.
          </p>
          {motionsError && (
            <div className="text-sm text-rose-300">{motionsError}</div>
          )}
          {motions.length === 0 && !motionsError && (
            <div className="text-sm text-zinc-500 inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading motions…
            </div>
          )}
          {motions.length > 0 && (
            <ul
              className="max-h-64 overflow-y-auto space-y-2 pr-1"
              role="list"
            >
              {motions.map((m) => (
                <li
                  key={m.id}
                  className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-3 py-2"
                >
                  <div className="text-sm font-medium text-zinc-100">
                    {m.title}
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">{m.text}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: In-room. Shared header + per-state content.
  // -------------------------------------------------------------------------
  const roomState = state?.state ?? "waiting";
  const paused = state?.paused ?? false;
  const motion = state?.motion ?? null;

  // Show motion only from prep onwards (Requirement 4.1 — hidden until then).
  const motionRevealed =
    !!motion &&
    (roomState === "prep" ||
      roomState === "speaking" ||
      roomState === "scoring" ||
      roomState === "complete");

  const banner = (
    <section className="card-glass p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="chip bg-violet-500/10 text-violet-300 border border-violet-500/30">
          <MessageSquareText className="w-3 h-3" />
          Group Debate
        </span>
        <span className="text-zinc-500 text-sm">
          Room{" "}
          <span className="font-mono text-zinc-300 tracking-widest">
            {roomCode}
          </span>
        </span>
        <button
          type="button"
          onClick={handleCopyCode}
          className="btn-ghost px-2 py-1 text-xs"
          aria-label="Copy room code"
        >
          {codeCopied ? (
            <>
              <Check className="w-3 h-3 text-emerald-300" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={connected ? "text-emerald-300" : "text-zinc-500"}>
          {connected ? (
            <Wifi className="w-3.5 h-3.5 inline" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 inline" />
          )}
          <span className="ml-1">
            {connected ? "Connected" : "Connecting…"}
          </span>
        </span>
        <button
          type="button"
          onClick={handleLeave}
          className="btn-ghost px-3 py-1.5"
        >
          <Home className="w-3.5 h-3.5" />
          Leave
        </button>
      </div>
    </section>
  );

  const participantsGrid = state && (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {state.participants.map((p) => (
        <ParticipantChip
          key={p.participant_id}
          participant={p}
          isYou={p.participant_id === participantId}
          isActive={
            typeof state.active_turn_index === "number" &&
            p.turn_index === state.active_turn_index &&
            (state.state === "speaking" || state.state === "scoring")
          }
        />
      ))}
    </section>
  );

  // ---------------- Per-state content ----------------
  let content: React.ReactNode = null;

  if (!state) {
    content = (
      <section className="card-glass p-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
        Connecting to debate…
      </section>
    );
  } else if (roomState === "waiting") {
    const iAmReady = myParticipant?.is_ready ?? false;
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6 text-center">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Share this code with your classmates
        </div>
        <div className="text-5xl md:text-6xl font-mono font-bold tracking-[0.35em] gradient-text">
          {roomCode}
        </div>
        <p className="text-sm text-zinc-400 max-w-xl mx-auto">
          Motion: <span className="text-zinc-500 italic">hidden until prep phase</span>.
          Debate auto-starts when all participants are ready (min 4).
        </p>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleFlipReady}
            disabled={readyBusy}
            className={iAmReady ? "btn-ghost px-6 py-3" : "btn-primary px-6 py-3"}
          >
            {readyBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating…
              </>
            ) : iAmReady ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" strokeWidth={2.6} />
                Ready · Tap to cancel
              </>
            ) : (
              <>
                <Check className="w-4 h-4" strokeWidth={2.6} />
                I'm Ready
              </>
            )}
          </button>
          <div className="text-xs text-zinc-500 tabular-nums">
            {readyCount} / {totalParticipants} ready
            {totalParticipants < 4 && " · need at least 4 players"}
          </div>
        </div>
      </section>
    );
  } else if (roomState === "prep") {
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">
            Prep phase · Motion revealed
          </div>
          {motion && (
            <>
              <h2 className="text-2xl md:text-3xl font-bold text-zinc-100 leading-tight max-w-3xl mx-auto">
                {motion.title}
              </h2>
              <p className="text-base text-zinc-400 max-w-3xl mx-auto leading-relaxed">
                {motion.text}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-center">
          <div
            className={[
              "font-mono text-6xl md:text-7xl tabular-nums font-bold",
              prepRemaining != null && prepRemaining <= 10
                ? "text-rose-300"
                : "text-zinc-100",
            ].join(" ")}
          >
            {formatSeconds(prepRemaining)}
          </div>
        </div>
        <p className="text-center text-xs text-zinc-500">
          Get ready. Each turn is 120 seconds (+15s grace period).
        </p>
      </section>
    );
  } else if (roomState === "speaking" && isMyTurn) {
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6">
        {motionRevealed && motion && (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Motion
            </div>
            <p className="text-sm text-zinc-300 mt-1 leading-relaxed max-w-2xl mx-auto">
              {motion.text}
            </p>
          </div>
        )}
        <div className="flex flex-col items-center gap-4">
          <div className="text-[10px] uppercase tracking-widest text-fuchsia-300 font-semibold">
            Your turn · Speak now
          </div>
          <div
            className={[
              "font-mono text-6xl md:text-7xl tabular-nums font-bold",
              turnRemaining != null && turnRemaining <= 15
                ? "text-rose-300"
                : "text-zinc-100",
            ].join(" ")}
          >
            {formatSeconds(turnRemaining)}
          </div>
          <div className="inline-flex items-center gap-2 text-sm">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
            <Mic className="w-4 h-4 text-rose-300" />
            <span className="text-zinc-200 font-medium">
              {recorder.isRecording
                ? "Recording…"
                : uploadingTurn
                ? "Uploading…"
                : "Preparing microphone…"}
            </span>
          </div>
          {recorder.error && (
            <div className="text-xs text-rose-300">{recorder.error}</div>
          )}
          {uploadError && (
            <div className="text-xs text-rose-300">{uploadError}</div>
          )}
          <button
            type="button"
            onClick={handleManualStop}
            disabled={
              !recorder.isRecording || uploadingTurn || !!lastTurnResult
            }
            className="btn-primary px-6 py-3"
          >
            {uploadingTurn ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Submit early
              </>
            )}
          </button>
          <p className="text-xs text-zinc-500 text-center max-w-md">
            Your audio will auto-submit when the timer hits zero. Others
            will take their turn after you.
          </p>
        </div>
      </section>
    );
  } else if (roomState === "speaking") {
    // Waiting for another speaker
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6">
        {motionRevealed && motion && (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Motion
            </div>
            <p className="text-sm text-zinc-300 mt-1 leading-relaxed max-w-2xl mx-auto">
              {motion.text}
            </p>
          </div>
        )}
        <div className="flex flex-col items-center gap-4">
          <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">
            Currently speaking
          </div>
          <div className="text-2xl md:text-3xl font-bold text-zinc-100">
            {activeSpeaker
              ? participantLabel(activeSpeaker)
              : "Waiting for next speaker…"}
          </div>
          <CountdownBadge
            seconds={turnRemaining}
            label="Time left"
            danger={turnRemaining != null && turnRemaining <= 15}
          />
          <p className="text-xs text-zinc-500 text-center">
            AI scoring will begin after all turns are complete.
          </p>
          {lastTurnResult && (
            <div className="card-glass p-4 space-y-2 text-center max-w-md">
              <div className="inline-flex items-center gap-2 chip-emerald">
                <Check className="w-3 h-3" />
                Turn submitted!
              </div>
              <div className="text-2xl font-bold text-zinc-100">
                Score: {lastTurnResult.ai_score.toFixed(1)}/100
              </div>
              {lastTurnResult.score_breakdown && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-zinc-400">Pronunciation</div>
                    <div className="text-zinc-100 font-semibold">
                      {lastTurnResult.score_breakdown.pronunciation?.weighted?.toFixed(1) ?? "N/A"}/25
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-zinc-400">Fluency</div>
                    <div className="text-zinc-100 font-semibold">
                      {lastTurnResult.score_breakdown.fluency?.weighted?.toFixed(1) ?? "N/A"}/25
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-zinc-400">Content</div>
                    <div className="text-zinc-100 font-semibold">
                      {lastTurnResult.content_score?.toFixed(1) ?? "N/A"}/50
                    </div>
                  </div>
                </div>
              )}
              {lastTurnResult.content_feedback && (
                <p className="text-xs text-zinc-400 italic">
                  "{lastTurnResult.content_feedback}"
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    );
  } else if (roomState === "scoring") {
    content = (
      <section className="card-glass p-10 md:p-14 flex flex-col items-center gap-4 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-300" />
        <div className="text-lg font-semibold text-zinc-100">
          AI is finalising scores…
        </div>
        <p className="text-sm text-zinc-500 max-w-md">
          Processing all turns. One moment please.
        </p>
      </section>
    );
  } else if (roomState === "complete") {
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6">
        <div className="text-center space-y-2">
          <Trophy className="w-10 h-10 mx-auto text-amber-300" />
          <h2 className="text-3xl font-bold text-zinc-100">Results</h2>
          {motion && (
            <p className="text-sm text-zinc-400 max-w-2xl mx-auto italic">
              "{motion.text}"
            </p>
          )}
        </div>

        {winner ? (
          <div className="card-glass bg-amber-500/5 border-amber-500/30 p-6 text-center space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">
              Winner
            </div>
            <div className="text-3xl font-bold text-amber-200">
              {participantLabel(winner)}
            </div>
            <p className="text-xs text-zinc-400">
              Highest effective score.
            </p>
          </div>
        ) : (
          <div className="card-glass border-zinc-700/60 border-dashed p-6 text-center text-sm text-zinc-400">
            No winner could be determined for this debate.
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold text-center">
            Participants
          </div>
          <ul className="space-y-2" role="list">
            {state?.participants.map((p) => (
              <li
                key={p.participant_id}
                className={[
                  "card-glass p-3 flex items-center gap-3",
                  p.participant_id === state.winner_participant_id
                    ? "border-amber-500/40 ring-1 ring-amber-500/30"
                    : "",
                ].join(" ")}
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-semibold text-white">
                  {participantLabel(p).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate">
                    {participantLabel(p)}
                    {p.participant_id === participantId && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-widest text-brand-300 font-semibold">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                    Speaker {p.turn_index + 1}
                    {p.is_forfeit && " · Forfeit"}
                  </div>
                </div>
                {p.participant_id === state.winner_participant_id && (
                  <Trophy className="w-4 h-4 text-amber-300" />
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500 text-center">
            Full scorecard available in 'My Debates' section.
          </p>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLeave}
            className="btn-primary px-6 py-3"
          >
            <Home className="w-4 h-4" />
            Back to menu
          </button>
        </div>
      </section>
    );
  } else if (roomState === "abandoned") {
    content = (
      <section className="card-glass p-8 md:p-12 flex flex-col items-center gap-4 text-center">
        <div className="text-rose-300 text-lg font-semibold">
          Debate ended early.
        </div>
        <p className="text-sm text-zinc-500 max-w-md">
          Enough participants disconnected that the debate could not continue.
          No record was saved.
        </p>
        <button
          type="button"
          onClick={handleLeave}
          className="btn-primary px-6 py-3"
        >
          <Home className="w-4 h-4" />
          Back to menu
        </button>
      </section>
    );
  }

  return (
    <div key="debate-arena" className="animate-fade-in-up space-y-5">
      {banner}
      {participantsGrid}
      {socketError && roomState !== "abandoned" && roomState !== "complete" && (
        <div className="card-glass px-4 py-3 text-sm text-amber-200 border-amber-500/40">
          {socketError}
        </div>
      )}
      {joinError && (
        <div className="card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
          {joinError}
        </div>
      )}
      {content}
      {paused &&
        (roomState === "prep" ||
          roomState === "speaking" ||
          roomState === "scoring") && (
          <PausedOverlay
            disconnectedName={disconnectedName}
            reconnectRemaining={reconnectRemaining}
          />
        )}
    </div>
  );
}
