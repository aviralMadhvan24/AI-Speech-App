import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Award,
  Check,
  Copy,
  Home,
  Loader2,
  Mic,
  MicOff,
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
  endSpeech,
  fetchGDTopics,
  flipGDReady,
  getGDResults,
  getLiveKitToken,
  joinGDRoom,
  startSpeech,
  type GDParticipantPublic,
  type GDResultsResponse,
  type GDTopic,
  type LiveKitTokenResponse,
} from "../gdApi";
import { useGDSocket } from "../hooks/useGDSocket";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useLiveKitAudio } from "../hooks/useLiveKitAudio";
import { useToast } from "./Toast";

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
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xs font-semibold text-white relative">
        {participant.display_name.charAt(0).toUpperCase()}
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
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [topics, setTopics] = useState<GDTopic[]>([]);
  const [readyBusy, setReadyBusy] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [codeCopied, setCodeCopied] = useState(false);
  const [results, setResults] = useState<GDResultsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  
  // PTT state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSpeechId, setCurrentSpeechId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  // LiveKit token state
  const [liveKitToken, setLiveKitToken] = useState<LiveKitTokenResponse | null>(null);
  const [liveKitError, setLiveKitError] = useState<string | null>(null);

  const { state, connected } = useGDSocket(roomCode, participantId);
  const recorder = useAudioRecorder();
  const toast = useToast();

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
    if (state?.state === "complete" && roomCode && !results && !resultsLoading) {
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
        toast.success("Discussion started!", "Hold SPACE to speak");
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

  // ------- PTT Handlers (Click to Start/Stop instead of Hold) -------
  const [isStartingSpeech, setIsStartingSpeech] = useState(false);
  const [isStoppingSpeech, setIsStoppingSpeech] = useState(false);

  const handleToggleSpeech = useCallback(async () => {
    if (!roomCode) return;
    if (state?.state !== "discussion") return;
    
    // If currently speaking, stop
    if (isSpeaking && currentSpeechId) {
      if (isStoppingSpeech) return; // Prevent double-click
      
      // Immediately update UI - don't wait for anything
      const speechIdToEnd = currentSpeechId;
      const roomCodeCopy = roomCode;
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      setSpeechError(null);
      
      // Show brief stopping indicator then clear
      setIsStoppingSpeech(true);
      setTimeout(() => setIsStoppingSpeech(false), 300);
      
      // Stop recording and upload in background (completely non-blocking)
      (async () => {
        try {
          const blob = await recorder.stop();
          recorder.reset();
          await endSpeech(roomCodeCopy, speechIdToEnd, blob);
        } catch (err) {
          console.error("[GD] Background stop/upload failed:", err);
          // Don't set error since UI already moved on
        }
      })();
      
      return;
    }
    
    // Start speaking
    if (isStartingSpeech) return; // Prevent double-click
    setIsStartingSpeech(true);
    setSpeechError(null);
    
    try {
      // Register with backend first
      const response = await startSpeech(roomCode);
      setCurrentSpeechId(response.speech_id);
      
      // Start local recording
      await recorder.start();
      setIsSpeaking(true);
    } catch (err) {
      setSpeechError(err instanceof Error ? err.message : "Failed to start speech");
      setIsSpeaking(false);
      setCurrentSpeechId(null);
    } finally {
      setIsStartingSpeech(false);
    }
  }, [roomCode, isSpeaking, currentSpeechId, state?.state, recorder, isStartingSpeech, isStoppingSpeech]);

  // Auto-stop after 90 seconds
  useEffect(() => {
    if (!isSpeaking || !currentSpeechId) return;
    const timer = window.setTimeout(() => {
      void handleToggleSpeech();
    }, 90 * 1000);
    return () => window.clearTimeout(timer);
  }, [isSpeaking, currentSpeechId, handleToggleSpeech]);

  // Space bar to toggle speech
  useEffect(() => {
    if (state?.state !== "discussion") return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        void handleToggleSpeech();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state?.state, handleToggleSpeech]);

  // ------- Lobby handlers -------
  const handleCreateRoom = useCallback(async () => {
    setCreating(true);
    setJoinError(null);
    try {
      const response = await createGDRoom();
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
      toast.success("Room created!", `Share code: ${response.room_code}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create room.";
      setJoinError(msg);
      toast.error("Failed to create room", msg);
    } finally {
      setCreating(false);
    }
  }, [toast]);

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
      setRoomCode(response.room_code);
      setParticipantId(response.participant_id);
      toast.success("Joined!", `Welcome to room ${cleaned}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not join.";
      setJoinError(msg);
      toast.error("Failed to join", msg);
    } finally {
      setJoining(false);
    }
  }, [joinCodeInput, toast]);

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
      // Stop speaking if active
      if (isSpeaking && currentSpeechId) {
        try {
          const blob = await recorder.stop();
          await endSpeech(roomCode, currentSpeechId, blob);
          setIsSpeaking(false);
          setCurrentSpeechId(null);
          recorder.reset();
        } catch {
          // Ignore errors, just end discussion
        }
      }
      await endDiscussion(roomCode);
      toast.info("Ending discussion...", "AI is processing all speeches");
    } catch (err) {
      toast.error("Failed to end", err instanceof Error ? err.message : "Try again");
      console.warn("End discussion failed:", err);
    } finally {
      setIsEndingDiscussion(false);
    }
  }, [roomCode, isEndingDiscussion, isSpeaking, currentSpeechId, recorder, toast]);

  const handleLeave = useCallback(() => {
    if (isSpeaking && currentSpeechId) {
      void handleToggleSpeech();
    }
    setRoomCode(null);
    setParticipantId(null);
    setResults(null);
    setJoinCodeInput("");
    onBack();
  }, [isSpeaking, currentSpeechId, handleToggleSpeech, onBack]);

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
              Real group discussion with 5-10 participants. Push-to-talk mode —
              hold the button to speak. 15 min discussion, then individual scores and rankings.
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
              A topic will be auto-assigned. 5-10 participants can join.
              Once everyone is ready: 2 min prep + 15 min discussion.
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
              A random topic is assigned on room creation.
            </p>
            <ul className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {topics.slice(0, 10).map((t) => (
                <li key={t.id} className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-3 py-2">
                  <div className="text-sm font-medium text-zinc-100">{t.title}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{t.text}</div>
                </li>
              ))}
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
        <p className="text-sm text-zinc-400 max-w-xl mx-auto">
          Topic hidden until prep phase. Need 5-10 people. GD auto-starts when
          all ready (min 5).
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
          Prepare your thoughts. Discussion lasts 15 minutes. Push-to-Talk mode.
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

        {/* Click-to-Talk Button (Toggle) */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleToggleSpeech}
            disabled={isStartingSpeech || isStoppingSpeech}
            className={[
              "w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-all",
              "font-bold text-lg shadow-lg select-none",
              isStartingSpeech || isStoppingSpeech
                ? "bg-zinc-600 cursor-wait"
                : isSpeaking
                ? "bg-gradient-to-br from-rose-500 to-red-600 scale-110 shadow-rose-500/50 animate-pulse"
                : "bg-gradient-to-br from-emerald-500 to-cyan-500 hover:scale-105 shadow-emerald-500/30",
            ].join(" ")}
          >
            <div className="flex flex-col items-center gap-1 text-white">
              {isStartingSpeech ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-xs">STARTING...</span>
                </>
              ) : isStoppingSpeech ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-xs">STOPPING...</span>
                </>
              ) : isSpeaking ? (
                <>
                  <Mic className="w-8 h-8" />
                  <span className="text-xs">TAP TO STOP</span>
                </>
              ) : (
                <>
                  <MicOff className="w-8 h-8" />
                  <span className="text-xs">TAP TO SPEAK</span>
                </>
              )}
            </div>
          </button>
          <p className="text-xs text-zinc-500 text-center">
            Tap to start speaking, tap again to stop. Or press SPACE.
          </p>
          {speechError && (
            <div className="text-xs text-rose-300 bg-rose-500/10 px-3 py-1 rounded">
              {speechError}
            </div>
          )}
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

        {/* End button */}
        <div className="text-center">
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

        {results && (
          <div className="space-y-3">
            <div className="text-center text-xs text-zinc-500">
              {results.total_speeches} speeches · {Math.floor(results.duration_seconds / 60)} min
            </div>
            
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
                      <div className={[
                        "text-2xl font-bold",
                        score.total_score >= 70 ? "text-emerald-300" :
                        score.total_score >= 50 ? "text-zinc-100" :
                        score.total_score >= 30 ? "text-amber-300" : "text-rose-300"
                      ].join(" ")}>
                        {score.total_score.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-zinc-500 uppercase">/ 100</div>
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
