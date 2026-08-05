import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Award,
  Clock,
  Check,
  Copy,
  Home,
  Loader2,
  Mic,
  MessageCircle,
  Phone,
  PhoneOff,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Users2,
} from "lucide-react";
import {
  createGDRoom,
  endDiscussion,
  fetchGDTopics,
  flipGDReady,
  getGDResults,
  getLiveKitToken,
  joinGDRoom,
  type GDParticipantPublic,
  type GDResultsResponse,
  type GDTopic,
  type LiveKitTokenResponse,
} from "../gdApi";
import { useNavigate, useParams } from "react-router-dom";
import { useGDSocket } from "../hooks/useGDSocket";
import { useLiveKitAudio } from "../hooks/useLiveKitAudio";
import {
  clearRoomSession,
  readRoomSession,
  saveRoomSession,
} from "../lib/roomSession";
import { useToast } from "./Toast";
import { Avatar } from "./Avatar";
import { TopicSelect } from "./TopicSelect";

interface GDArenaViewProps {
  onBack: () => void;
}

function formatSeconds(sec: number | null): string {
  if (sec == null) return "--:--";
  const clamped = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
  const ss = String(clamped % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function ParticipantCard({
  participant,
  isYou,
}: {
  participant: GDParticipantPublic;
  isYou: boolean;
}) {
  const speakMinutes = Math.floor(participant.total_speak_seconds / 60);
  const speakSecs = Math.floor(participant.total_speak_seconds % 60);
  
  return (
    <div
      className={[
        "card-glass px-3 py-2 flex items-center gap-2 transition-all",
        participant.is_currently_speaking
          ? "border-rose-500/60 ring-2 ring-rose-500/40 bg-rose-500/5"
          : "",
        isYou ? "border-brand-500/40" : "",
      ].join(" ")}
    >
      <div className="relative">
        <Avatar
          src={participant.avatar_url}
          name={participant.display_name}
          className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-cyan-500 text-xs font-semibold text-white"
        />
        {participant.is_currently_speaking && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-zinc-100 truncate">
          {participant.display_name}
          {isYou && (
            <span className="ml-1.5 text-[9px] uppercase tracking-widest text-brand-300 font-semibold">
              You
            </span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">
          {participant.speech_count} speeches · {speakMinutes}:{String(speakSecs).padStart(2, "0")}
        </div>
      </div>
      {participant.is_currently_speaking ? (
        <span className="chip bg-rose-500/10 text-rose-300 border border-rose-500/30">
          <Mic className="w-3 h-3" />
          Live
        </span>
      ) : participant.is_ready ? (
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

export function GDArenaView({ onBack }: GDArenaViewProps) {
  // ------- Routing: room code travels in the URL (/gd/:code) -------
  const { code: codeParam } = useParams<{ code?: string }>();
  const navigate = useNavigate();

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [topics, setTopics] = useState<GDTopic[]>([]);
  // null = let the backend pick a random topic.
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [readyBusy, setReadyBusy] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [scoringMode, setScoringMode] = useState<"instant" | "detailed">("instant");
  const [joining, setJoining] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [codeCopied, setCodeCopied] = useState(false);
  const [results, setResults] = useState<GDResultsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  
  // LiveKit token state
  const [liveKitToken, setLiveKitToken] = useState<LiveKitTokenResponse | null>(null);
  const [liveKitError, setLiveKitError] = useState<string | null>(null);

  const { state, connected, error: socketError } = useGDSocket(
    roomCode,
    participantId,
  );
  const toast = useToast();

  // ------- Rehydrate + rejoin from /gd/:code on reload (Req 2.2) -------
  // Mirror of DebateArenaView: seed `roomCode` from the URL param and recover
  // `participantId` from the per-room store; fall back to the idempotent-by-uid
  // `joinGDRoom` (same participant, no duplicate) then persist. Once both are
  // set, `useGDSocket` connects and rejoins.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!codeParam) return;
    if (roomCode && participantId) return;
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;

    const normalized = codeParam.toUpperCase();
    const stored = readRoomSession("gd", normalized);
    if (stored?.participantId) {
      setRoomCode(normalized);
      setParticipantId(stored.participantId);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await joinGDRoom(normalized);
        if (cancelled) return;
        saveRoomSession("gd", response.room_code, {
          participantId: response.participant_id,
          savedAt: Date.now(),
        });
        setRoomCode(response.room_code);
        setParticipantId(response.participant_id);
      } catch (err) {
        if (cancelled) return;
        // Room gone / not joinable — clear stale identity, drop to the lobby
        // with a message (Req 2.10).
        clearRoomSession("gd", normalized);
        const msg =
          err instanceof Error ? err.message : "Could not rejoin the room.";
        setJoinError(msg);
        toast.error("Could not rejoin", msg);
        navigate("/gd", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codeParam, roomCode, participantId, navigate, toast]);

  // ------- Stale room: socket closed 4404 → lobby + message (Req 2.10) -------
  useEffect(() => {
    if (!socketError || !roomCode) return;
    if (!socketError.includes("no longer exists")) return;
    clearRoomSession("gd", roomCode);
    setRoomCode(null);
    setParticipantId(null);
    setJoinError("This GD room no longer exists.");
    toast.error("Room closed", "This GD room no longer exists.");
    navigate("/gd", { replace: true });
  }, [socketError, roomCode, navigate, toast]);

  // LiveKit live audio - enabled during prep and discussion phases
  const liveKitAudio = useLiveKitAudio({
    serverUrl: liveKitToken?.url || null,
    token: liveKitToken?.token || null,
    enabled: (state?.state === "prep" || state?.state === "discussion") && !!liveKitToken,
  });

  // Fetch LiveKit token when room enters prep/discussion phase
  useEffect(() => {
    if (!roomCode || !state?.livekit_room) return;
    if (state.state !== "prep" && state.state !== "discussion") return;
    if (liveKitToken) return; // Already have token

    getLiveKitToken(roomCode)
      .then((token) => {
        setLiveKitToken(token);
        setLiveKitError(null);
        console.log("[LiveKit] Token received for room:", token.room);
      })
      .catch((err) => {
        console.error("[LiveKit] Token fetch failed:", err);
        setLiveKitError(err instanceof Error ? err.message : "Failed to get audio token");
      });
  }, [roomCode, state?.livekit_room, state?.state, liveKitToken]);

  // Debug LiveKit audio state
  useEffect(() => {
    console.log("[LiveKit Debug]", {
      livekitRoom: state?.livekit_room,
      roomState: state?.state,
      hasToken: !!liveKitToken,
      liveKitAudioState: {
        isJoined: liveKitAudio.isJoined,
        isConnecting: liveKitAudio.isConnecting,
        error: liveKitAudio.error || liveKitError,
      },
    });
  }, [state?.livekit_room, state?.state, liveKitToken, liveKitAudio.isJoined, liveKitAudio.isConnecting, liveKitAudio.error, liveKitError]);

  // Load topics
  useEffect(() => {
    fetchGDTopics()
      .then((list) => setTopics(list))
      .catch(() => setTopics([]));
  }, []);

  // Ticking clock
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 500);
    return () => window.clearInterval(id);
  }, []);

  // Load results when scoring completes
  useEffect(() => {
    if (state?.state === "complete" && state.scoring_mode !== "detailed" && roomCode && !results && !resultsLoading) {
      setResultsLoading(true);
      getGDResults(roomCode)
        .then((r) => {
          setResults(r);
          toast.success("Results ready!", "Check your scores below");
        })
        .catch((err) => console.warn("Results fetch failed:", err))
        .finally(() => setResultsLoading(false));
    }
  }, [state?.state, roomCode, results, resultsLoading, toast]);
  
  // Toast on phase transitions
  const prevStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state?.state) return;
    const prev = prevStateRef.current;
    if (prev && prev !== state.state) {
      if (state.state === "prep") {
        toast.info("Get ready!", "Topic revealed. 2 min prep time.");
      } else if (state.state === "discussion") {
        toast.success("Discussion started!", "Speak naturally — you're being recorded");
      } else if (state.state === "scoring") {
        toast.info("Analyzing...", "AI is processing all speeches");
      }
    }
    prevStateRef.current = state.state;
  }, [state?.state, toast]);

  // Poll for results in scoring phase
  useEffect(() => {
    if (state?.state !== "scoring" || !roomCode) return;
    const interval = window.setInterval(async () => {
      try {
        const r = await getGDResults(roomCode);
        setResults(r);
      } catch {
        // Results not ready yet
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [state?.state, roomCode]);

  // Detailed mode: pronunciation scoring finishes minutes after the instant
  // scores, so keep polling once complete until every full score has landed.
  useEffect(() => {
    if (state?.state !== "complete" || !roomCode || state?.scoring_mode === "detailed") return;
    // Detailed results are deliberately only surfaced from My Performance.
    return;
    if (results?.scores.every((s) => s.full_score_ready)) return;

    const interval = window.setInterval(async () => {
      try {
        const r = await getGDResults(roomCode!);
        setResults(r);
        if (r.scores.every((s) => s.full_score_ready)) {
          window.clearInterval(interval);
          toast.success("Full scores ready!", "Pronunciation analysis complete");
        }
      } catch {
        // Not ready yet — keep polling
      }
    }, 10000);
    return () => window.clearInterval(interval);
  }, [state?.state, state?.scoring_mode, roomCode, results, toast]);

  const myParticipant = useMemo<GDParticipantPublic | null>(() => {
    if (!state || !participantId) return null;
    return state.participants.find((p) => p.participant_id === participantId) ?? null;
  }, [state, participantId]);

  const prepRemaining = state?.prep_deadline
    ? Math.max(0, state.prep_deadline - now)
    : null;
  const discussionRemaining = state?.discussion_deadline
    ? Math.max(0, state.discussion_deadline - now)
    : null;

  const readyCount = useMemo(
    () => state?.participants.filter((p) => p.is_ready).length ?? 0,
    [state],
  );

  // ------- Lobby handlers -------
  const handleCreateRoom = useCallback(async () => {
    setCreating(true);
    setJoinError(null);
    try {
      const response = await createGDRoom(scoringMode, selectedTopicId);
      saveRoomSession("gd", response.room_code, {
        participantId: response.participant_id,
        savedAt: Date.now(),
      });
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
      toast.success("Room created!", `Share code: ${response.room_code}`);
      navigate(`/gd/${response.room_code}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create room.";
      setJoinError(msg);
      toast.error("Failed to create room", msg);
    } finally {
      setCreating(false);
    }
  }, [toast, navigate, scoringMode, selectedTopicId]);

  const handleJoinRoom = useCallback(async () => {
    const cleaned = joinCodeInput.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(cleaned)) {
      setJoinError("Enter a valid 6-character code.");
      toast.warning("Invalid code", "Must be 6 characters (letters/digits)");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const response = await joinGDRoom(cleaned);
      saveRoomSession("gd", response.room_code, {
        participantId: response.participant_id,
        savedAt: Date.now(),
      });
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
      toast.success("Joined!", `Welcome to room ${cleaned}`);
      navigate(`/gd/${response.room_code}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not join.";
      setJoinError(msg);
      toast.error("Failed to join", msg);
    } finally {
      setJoining(false);
    }
  }, [joinCodeInput, toast, navigate]);

  const handleFlipReady = useCallback(async () => {
    if (!roomCode) return;
    setReadyBusy(true);
    try {
      await flipGDReady(roomCode);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Ready failed");
    } finally {
      setReadyBusy(false);
    }
  }, [roomCode]);

  const [isEndingDiscussion, setIsEndingDiscussion] = useState(false);
  
  const handleEndDiscussion = useCallback(async () => {
    if (!roomCode || isEndingDiscussion) return;
    setIsEndingDiscussion(true);
    try {
      await endDiscussion(roomCode);
      toast.info("Ending discussion...", "AI is processing all recordings");
    } catch (err) {
      toast.error("Failed to end", err instanceof Error ? err.message : "Try again");
      console.warn("End discussion failed:", err);
    } finally {
      setIsEndingDiscussion(false);
    }
  }, [roomCode, isEndingDiscussion, toast]);

  const handleLeave = useCallback(() => {
    if (roomCode) {
      clearRoomSession("gd", roomCode);
    }
    setRoomCode(null);
    setParticipantId(null);
    setResults(null);
    setJoinCodeInput("");
    navigate("/gd");
  }, [navigate, roomCode]);

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCodeCopied(true);
      toast.info("Code copied!", "Share with your teammates");
      window.setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      toast.error("Copy failed", "Please copy manually");
    }
  };

  // -------------------------------------------------------------------------
  // Render: Lobby
  // -------------------------------------------------------------------------
  if (!roomCode || !participantId) {
    return (
      <div className="space-y-5 animate-fade-in-up">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="btn-ghost inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full">
            <Users2 className="w-3.5 h-3.5" />
            <span>Group Discussion · Live</span>
          </div>
        </div>

        <header className="card-glass relative overflow-hidden p-6 md:p-8">
          <div
            aria-hidden
            className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/25 via-cyan-500/15 to-transparent blur-3xl"
          />
          <div className="relative">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Group{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-300 via-cyan-400 to-blue-400 animate-gradient-shift bg-[length:200%_200%]">
                Discussion
              </span>
            </h1>
            <p className="mt-2 text-zinc-400 text-sm md:text-base max-w-2xl leading-relaxed">
              Real group discussion with 5-10 participants. Live voice mode —
              speak naturally, AI records and analyzes. 15 min discussion, then individual scores and rankings.
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
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-glow-sm flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Create GD room</h2>
                <p className="text-xs text-zinc-500">Create a new room and share the code.</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400">
              Pick a topic or leave it random. 5-10 participants can join.
              Once everyone is ready: 2 min prep + 15 min discussion.
            </p>
            {/* Topic picker. Mirrors the selectable list further down the page. */}
            <TopicSelect
              label="Topic"
              options={topics}
              value={selectedTopicId}
              onChange={setSelectedTopicId}
              randomLabel="Random topic"
              accent="emerald"
              disabled={topics.length === 0}
              emptyLabel="Loading topics…"
            />
            {/* Scoring mode toggle */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Scoring mode</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScoringMode("instant")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                    scoringMode === "instant"
                      ? "bg-emerald-600/30 border-emerald-500/60 text-emerald-200"
                      : "bg-zinc-800/50 border-zinc-700/40 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="block text-sm">⚡ Instant</span>
                  <span className="block text-[10px] mt-0.5 opacity-70">Content + Fluency</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScoringMode("detailed")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                    scoringMode === "detailed"
                      ? "bg-cyan-600/30 border-cyan-500/60 text-cyan-200"
                      : "bg-zinc-800/50 border-zinc-700/40 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="block text-sm">🎯 Detailed</span>
                  <span className="block text-[10px] mt-0.5 opacity-70">+ Pronunciation (2-3 min)</span>
                </button>
              </div>
            </div>
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
                  <MessageCircle className="w-4 h-4" />
                  Create GD Room
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
                <h2 className="text-lg font-semibold text-zinc-100">Join by code</h2>
                <p className="text-xs text-zinc-500">Enter the room code.</p>
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
              maxLength={6}
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] uppercase text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
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

        {topics.length > 0 && (
          <section className="card-glass p-6 md:p-7 space-y-3">
            <h2 className="text-lg font-semibold text-zinc-100">
              Available Topics ({topics.length})
            </h2>
            <p className="text-xs text-zinc-500">
              Tap a topic to use it for your next room, or leave it unselected for
              a random one.
            </p>
            <ul className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {topics.map((t) => {
                const isSelected = selectedTopicId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedTopicId(isSelected ? null : t.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                        isSelected
                          ? "border-emerald-500/60 bg-emerald-600/15"
                          : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-zinc-100">{t.title}</div>
                        {isSelected && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-400">{t.text}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: In-room
  // -------------------------------------------------------------------------
  const roomState = state?.state ?? "waiting";
  const topic = state?.topic ?? null;

  const banner = (
    <section className="card-glass p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
          <Users2 className="w-3 h-3" />
          Group Discussion
        </span>
        <span className="text-zinc-500 text-sm">
          Room{" "}
          <span className="font-mono text-zinc-300 tracking-widest">{roomCode}</span>
        </span>
        <button
          type="button"
          onClick={handleCopyCode}
          className="btn-ghost px-2 py-1 text-xs"
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
          {connected ? <Wifi className="w-3.5 h-3.5 inline" /> : <WifiOff className="w-3.5 h-3.5 inline" />}
          <span className="ml-1">{connected ? "Connected" : "Connecting…"}</span>
        </span>
        <button type="button" onClick={handleLeave} className="btn-ghost px-3 py-1.5">
          <Home className="w-3.5 h-3.5" />
          Leave
        </button>
      </div>
    </section>
  );

  const participantsGrid = state && (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {state.participants.map((p) => (
        <ParticipantCard
          key={p.participant_id}
          participant={p}
          isYou={p.participant_id === participantId}
        />
      ))}
    </section>
  );

  let content: React.ReactNode = null;

  if (!state) {
    content = (
      <section className="card-glass p-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting…
      </section>
    );
  } else if (roomState === "waiting") {
    const iAmReady = myParticipant?.is_ready ?? false;
    const autoStartRemaining = state?.auto_start_deadline
      ? Math.max(0, state.auto_start_deadline - now)
      : null;
    
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6 text-center">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Share this code with teammates
        </div>
        <div className="text-5xl md:text-6xl font-mono font-bold tracking-[0.35em] gradient-text">
          {roomCode}
        </div>
        {/* A host-chosen topic is shown right away; a random one stays hidden
            (the server does not even send it) until prep. */}
        {state?.topic_chosen && topic ? (
          <div className="mx-auto max-w-2xl rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
              Topic
            </div>
            <h3 className="mt-1 text-lg font-semibold leading-snug text-zinc-100">
              {topic.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{topic.text}</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400 max-w-xl mx-auto">
            Topic hidden until prep phase.
          </p>
        )}
        <p className="text-sm text-zinc-400 max-w-xl mx-auto">
          Need 5-10 people. GD auto-starts when all ready (min 5).
        </p>
        
        {/* Countdown timer when all ready */}
        {autoStartRemaining != null && autoStartRemaining > 0 && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-6 py-4 animate-pulse">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-1">
              All Ready! Starting in
            </div>
            <div className="font-mono text-4xl md:text-5xl font-bold text-emerald-300">
              {Math.ceil(autoStartRemaining)}s
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Late joiners can still enter before countdown ends
            </p>
          </div>
        )}
        
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
                <Check className="w-4 h-4 text-emerald-300" />
                Ready · Tap to cancel
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                I'm Ready
              </>
            )}
          </button>
          <div className="text-xs text-zinc-500 tabular-nums">
            {readyCount} / {state.participants.length} ready
            {state.participants.length < 5 && ` · need at least 5 players`}
          </div>
        </div>
      </section>
    );
  } else if (roomState === "prep") {
    content = (
      <section className="card-glass p-8 md:p-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
            Prep Phase · Topic Revealed
          </div>
          {topic && (
            <>
              <h2 className="text-2xl md:text-3xl font-bold text-zinc-100 leading-tight">
                {topic.title}
              </h2>
              <p className="text-base text-zinc-400 max-w-3xl mx-auto leading-relaxed">
                {topic.text}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-center">
          <div
            className={[
              "font-mono text-6xl md:text-7xl tabular-nums font-bold",
              prepRemaining != null && prepRemaining <= 15
                ? "text-rose-300"
                : "text-zinc-100",
            ].join(" ")}
          >
            {formatSeconds(prepRemaining)}
          </div>
        </div>
        
        {/* Live Audio Status */}
        <div className="flex justify-center">
          <div className={[
            "inline-flex items-center gap-3 px-4 py-2 rounded-full border",
            liveKitAudio.isJoined
              ? "bg-emerald-500/10 border-emerald-500/30"
              : liveKitAudio.isConnecting
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-zinc-800/60 border-zinc-700/50"
          ].join(" ")}>
            {liveKitAudio.isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                <span className="text-sm text-amber-300">Connecting to audio...</span>
              </>
            ) : liveKitAudio.isJoined ? (
              <>
                <Volume2 className="w-4 h-4 text-emerald-300" />
                <span className="text-sm text-emerald-300">Live audio connected ({liveKitAudio.participantCount})</span>
                <button
                  type="button"
                  onClick={() => void liveKitAudio.toggleMute()}
                  className={[
                    "p-1.5 rounded-full transition-all",
                    liveKitAudio.isMuted
                      ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                      : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  ].join(" ")}
                  title={liveKitAudio.isMuted ? "Unmute" : "Mute"}
                >
                  {liveKitAudio.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </>
            ) : (liveKitAudio.error || liveKitError) ? (
              <>
                <WifiOff className="w-4 h-4 text-rose-300" />
                <span className="text-sm text-rose-300">Audio unavailable</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-zinc-500" />
                <span className="text-sm text-zinc-500">Setting up audio...</span>
              </>
            )}
          </div>
        </div>
        
        <p className="text-center text-xs text-zinc-500">
          Prepare your thoughts. Discussion lasts 15 minutes. Your voice is recorded automatically.
        </p>
      </section>
    );
  } else if (roomState === "discussion") {
    content = (
      <section className="card-glass p-6 md:p-8 space-y-6">
        {/* Topic banner */}
        {topic && (
          <div className="text-center pb-4 border-b border-zinc-800/60">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
              Topic
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-zinc-100 mt-1">
              {topic.title}
            </h3>
          </div>
        )}

        {/* Timer */}
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Discussion Time Left
          </div>
          <div
            className={[
              "font-mono text-5xl md:text-6xl tabular-nums font-bold mt-2",
              discussionRemaining != null && discussionRemaining <= 60
                ? "text-rose-300"
                : "text-zinc-100",
            ].join(" ")}
          >
            {formatSeconds(discussionRemaining)}
          </div>
        </div>

        {/* Live Audio Controls */}
        <div className="flex justify-center">
          <div className={[
            "inline-flex items-center gap-3 px-4 py-2 rounded-full border",
            liveKitAudio.isJoined
              ? "bg-emerald-500/10 border-emerald-500/30"
              : liveKitAudio.isConnecting
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-zinc-800/60 border-zinc-700/50"
          ].join(" ")}>
            {liveKitAudio.isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                <span className="text-sm text-amber-300">Connecting...</span>
              </>
            ) : liveKitAudio.isJoined ? (
              <>
                <Phone className="w-4 h-4 text-emerald-300" />
                <span className="text-sm text-emerald-300">Live ({liveKitAudio.participantCount})</span>
                <div className="h-4 w-px bg-zinc-600" />
                <button
                  type="button"
                  onClick={() => void liveKitAudio.toggleMute()}
                  className={[
                    "flex items-center gap-1.5 px-2 py-1 rounded-full transition-all text-xs font-medium",
                    liveKitAudio.isMuted
                      ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                      : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  ].join(" ")}
                >
                  {liveKitAudio.isMuted ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5" />
                      Muted
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      Listening
                    </>
                  )}
                </button>
              </>
            ) : (liveKitAudio.error || liveKitError) ? (
              <>
                <PhoneOff className="w-4 h-4 text-rose-300" />
                <span className="text-sm text-rose-300">Audio failed</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-zinc-500" />
                <span className="text-sm text-zinc-500">Setting up...</span>
              </>
            )}
          </div>
        </div>

        {/* Active speakers indicator */}
        {state.active_speakers.length > 0 && (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-rose-300 font-semibold">
              🎙️ Currently Speaking
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {state.active_speakers.map((sp) => (
                <span
                  key={sp.participant_id}
                  className="chip bg-rose-500/10 text-rose-300 border border-rose-500/30"
                >
                  {sp.display_name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recording indicator (Egress handles recording automatically) */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border-2 border-emerald-500/40 animate-pulse">
            <div className="flex flex-col items-center gap-1 text-emerald-300">
              <Mic className="w-8 h-8" />
              <span className="text-xs font-semibold">RECORDING</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center max-w-xs">
            Your voice is being recorded automatically. Just speak naturally — AI will analyze when the discussion ends.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-800/40 rounded-lg p-2">
            <div className="text-xs text-zinc-500">Total Speeches</div>
            <div className="text-lg font-bold text-zinc-100">{state.total_speeches}</div>
          </div>
          <div className="bg-zinc-800/40 rounded-lg p-2">
            <div className="text-xs text-zinc-500">Your Speeches</div>
            <div className="text-lg font-bold text-zinc-100">
              {myParticipant?.speech_count ?? 0}
            </div>
          </div>
          <div className="bg-zinc-800/40 rounded-lg p-2">
            <div className="text-xs text-zinc-500">Your Time</div>
            <div className="text-lg font-bold text-zinc-100">
              {Math.floor((myParticipant?.total_speak_seconds ?? 0))}s
            </div>
          </div>
        </div>

        {/* End button - host only */}
        <div className="text-center">
          {myParticipant?.is_host ? (
            <button
              type="button"
              onClick={handleEndDiscussion}
              disabled={isEndingDiscussion}
              className="btn-primary px-4 py-2"
            >
              {isEndingDiscussion ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ending...
                </>
              ) : (
                "End Discussion & Get Scores"
              )}
            </button>
          ) : (
            <p className="text-xs text-zinc-500">
              Only the host can end the discussion.
            </p>
          )}
        </div>
      </section>
    );
  } else if (roomState === "scoring") {
    content = (
      <section className="card-glass p-10 md:p-14 flex flex-col items-center gap-4 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-300" />
        <div className="text-xl font-semibold text-zinc-100">
          AI is analyzing the discussion…
        </div>
        <p className="text-sm text-zinc-400 max-w-md">
          Processing {state.total_speeches} speeches.
          Individual scores and rankings will be ready in 30-60 seconds.
        </p>
      </section>
    );
  } else if (roomState === "complete") {
    content = (
      <section className="card-glass p-6 md:p-8 space-y-6">
        <div className="text-center">
          <Trophy className="w-12 h-12 mx-auto text-amber-300" />
          <h2 className="text-2xl md:text-3xl font-bold text-zinc-100 mt-2">
            Discussion Complete!
          </h2>
          {topic && (
            <p className="text-sm text-zinc-400 mt-1 italic">"{topic.text}"</p>
          )}
        </div>

        {!results && resultsLoading && (
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-300" />
            <p className="text-sm text-zinc-400 mt-2">Loading results…</p>
          </div>
        )}

        {state?.scoring_mode === "detailed" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
            <Clock className="mx-auto h-8 w-8 text-amber-300" />
            <h3 className="mt-2 text-lg font-semibold text-zinc-100">Detailed result is being prepared</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
              Your result will be available after the detailed analysis finishes. Please check the My Performance section in a few minutes.
            </p>
          </div>
        )}

        {results && state?.scoring_mode !== "detailed" && (
          <div className="space-y-3">
            <div className="text-center text-xs text-zinc-500">
              {results.total_speeches} speeches · {Math.floor(results.duration_seconds / 60)} min
            </div>

            {/* Detailed mode: pronunciation runs in the background after the
                instant scores land, so tell the user where to look. */}
            {results && Boolean(false) && (
              <div className="text-center text-xs px-4">
                {results.scores.some((s) => s.full_score_ready) ? (
                  <span className="text-emerald-400">
                    ✓ Full pronunciation scores ready
                  </span>
                ) : (
                  <span className="text-amber-400">
                    ⏳ Pronunciation analysis in progress — full scores update in
                    1-3 minutes. This page refreshes automatically.
                  </span>
                )}
              </div>
            )}
            
            {results.scores.map((score) => {
              const isYou = score.participant_id === participantId;
              const isWinner = score.rank === 1;
              return (
                <div
                  key={score.participant_id}
                  className={[
                    "card-glass p-4",
                    isYou ? "border-brand-500/40 ring-1 ring-brand-500/30" : "",
                    isWinner ? "border-amber-500/40 bg-amber-500/5" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={[
                        "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                        isWinner ? "bg-amber-500 text-white" : "bg-zinc-700 text-zinc-300",
                      ].join(" ")}>
                        {score.rank}
                      </div>
                      <div>
                        <div className="font-semibold text-zinc-100">
                          {score.display_name}
                          {isYou && (
                            <span className="ml-2 text-[9px] uppercase tracking-widest text-brand-300 font-semibold">
                              You
                            </span>
                          )}
                          {isWinner && <Award className="w-4 h-4 inline ml-1 text-amber-300" />}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {score.speech_count} speeches · {Math.floor(score.total_speak_seconds)}s spoken
                          {score.interruption_count > 0 && (
                            <span className="text-amber-400 ml-1">
                              · {score.interruption_count} interruption{score.interruption_count > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {(() => {
                        // In detailed mode prefer the pronunciation-adjusted
                        // score once it's available.
                        const shown =
                          score.full_score_ready && score.full_total_score != null
                            ? score.full_total_score
                            : score.total_score;
                        return (
                          <>
                            <div className={[
                              "text-2xl font-bold",
                              shown >= 70 ? "text-emerald-300" :
                              shown >= 50 ? "text-zinc-100" :
                              shown >= 30 ? "text-amber-300" : "text-rose-300"
                            ].join(" ")}>
                              {shown.toFixed(1)}
                            </div>
                            <div className="text-[10px] text-zinc-500 uppercase">/ 100</div>
                            {score.full_score_ready &&
                              score.full_total_score != null &&
                              Math.abs(score.full_total_score - score.total_score) >= 0.05 && (
                                <div className="text-[9px] text-zinc-500 mt-0.5">
                                  was {score.total_score.toFixed(1)}
                                </div>
                              )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-5 gap-1 text-[10px]">
                    <div className="bg-zinc-800/50 rounded p-1 text-center">
                      <div className="text-zinc-500">Content</div>
                      <div className={[
                        "font-semibold",
                        score.content_quality >= 20 ? "text-emerald-300" :
                        score.content_quality >= 10 ? "text-zinc-200" : "text-rose-300"
                      ].join(" ")}>{score.content_quality.toFixed(0)}/30</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-1 text-center">
                      <div className="text-zinc-500">Comm.</div>
                      <div className="font-semibold text-zinc-200">{score.communication.toFixed(0)}/20</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-1 text-center">
                      <div className="text-zinc-500">Partic.</div>
                      <div className="font-semibold text-zinc-200">{score.participation.toFixed(0)}/20</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-1 text-center">
                      <div className="text-zinc-500">Listen</div>
                      <div className="font-semibold text-zinc-200">{score.listening.toFixed(0)}/15</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-1 text-center">
                      <div className="text-zinc-500">Lead.</div>
                      <div className="font-semibold text-zinc-200">{score.leadership.toFixed(0)}/15</div>
                    </div>
                  </div>
                  
                  {/* AI Feedback Section */}
                  {score.feedback && (
                    <div className="mt-3 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                      <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold mb-1.5">
                        🤖 AI Feedback
                      </div>
                      <div className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {score.feedback.split(" | ").map((part, idx) => (
                          <div key={idx} className={idx > 0 ? "mt-1.5" : ""}>
                            {part}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-center">
          <button type="button" onClick={handleLeave} className="btn-primary px-6 py-3">
            <Home className="w-4 h-4" />
            Back to menu
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-5">
      {banner}
      {participantsGrid}
      {content}
    </div>
  );
}
