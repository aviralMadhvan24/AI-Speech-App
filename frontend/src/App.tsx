import { useCallback, useEffect, useMemo, useState } from "react";
import { BackgroundOrbs } from "./components/BackgroundOrbs";
import { BattleLobbyView } from "./components/BattleLobbyView";
import { BattleResultView } from "./components/BattleResultView";
import { BattleRoomView } from "./components/BattleRoomView";
import { Header } from "./components/Header";
import { HomeView } from "./components/HomeView";
import { InterviewStudioView } from "./components/InterviewStudioView";
import { LoginView } from "./components/LoginView";
import { MainMenuView } from "./components/MainMenuView";
import { PracticeView } from "./components/PracticeView";
import { ProcessingView } from "./components/ProcessingView";
import { ReportView } from "./components/ReportView";
import { SpeedometerView } from "./components/SpeedometerView";
import { fetchSentences, fetchSessions, scoreAudio } from "./api";
import type { PlayerRole, RoomState } from "./battleApi";
import { useAuth } from "./hooks/useAuth";
import type {
  AnalyzeRaw,
  Difficulty,
  ScoreResult,
  Sentence,
  SessionPreview,
} from "./types";

type View =
  | "main-menu"
  | "home"
  | "practice"
  | "processing"
  | "report"
  | "battle-lobby"
  | "battle-room"
  | "battle-result"
  | "interview"
  | "cruise";

interface BattleSession {
  roomCode: string;
  playerId: string;
  role: PlayerRole;
  initialState: RoomState | null;
  finalState: RoomState | null;
}

function computeBestStreak(sessions: SessionPreview[]): number {
  const ordered = [...sessions].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let best = 0;
  let current = 0;
  for (const session of ordered) {
    if (typeof session.score === "number" && session.score >= 70) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

function computeWordsMastered(cache: Map<string, ScoreResult>): number {
  let total = 0;
  for (const report of cache.values()) {
    total += report.wordResults.filter((w) => w.correct).length;
  }
  return total;
}

export default function App() {
  const { user, signIn, signOut } = useAuth();

  const [view, setView] = useState<View>("main-menu");
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [sentencesError, setSentencesError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [report, setReport] = useState<ScoreResult | null>(null);
  const [degradedReport, setDegradedReport] = useState(false);
  const [hiddenSessionIds, setHiddenSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [, setReportCacheRaw] = useState<Map<string, AnalyzeRaw>>(
    () => new Map(),
  );
  const [reportCacheResult, setReportCacheResult] = useState<
    Map<string, ScoreResult>
  >(() => new Map());
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [battleSession, setBattleSession] = useState<BattleSession | null>(null);

  // Initial data loads — only once we're authenticated.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchSentences()
      .then((items) => {
        if (cancelled) return;
        setSentences(items);
        setSentencesError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not load sentences.";
        setSentencesError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
    } catch (err) {
      console.warn("Could not load attempts:", err);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshSessions();
  }, [refreshSessions, user]);

  const visibleSessions = useMemo(
    () => sessions.filter((s) => !hiddenSessionIds.has(s.sessionId)),
    [sessions, hiddenSessionIds],
  );

  const cachedSessionIds = useMemo(
    () => new Set(reportCacheResult.keys()),
    [reportCacheResult],
  );

  const bestStreak = useMemo(
    () => computeBestStreak(visibleSessions),
    [visibleSessions],
  );
  const wordsMastered = useMemo(
    () => computeWordsMastered(reportCacheResult),
    [reportCacheResult],
  );

  // --- Navigation ---

  const handleBackToMenu = useCallback(() => {
    setBattleSession(null);
    setView("main-menu");
  }, []);

  const handleBackToPronunciation = useCallback(() => {
    setView("home");
  }, []);

  const handleSelectPronunciation = useCallback(() => {
    setView("home");
  }, []);

  const handleSelectBattle = useCallback(() => {
    setBattleSession(null);
    setView("battle-lobby");
  }, []);

  const handleSelectInterview = useCallback(() => {
    setView("interview");
  }, []);

  const handleSelectFourth = useCallback(() => {
    setView("cruise");
  }, []);

  const handleStart = useCallback(() => {
    setSentenceIdx(0);
    setView("practice");
  }, []);

  // Kept for HomeView compatibility — its shortcut button still works.
  const handleStartBattleFromHome = useCallback(() => {
    setBattleSession(null);
    setView("battle-lobby");
  }, []);

  // --- Battle handlers ---

  const handleBattleCreated = useCallback(
    (response: {
      room_code: string;
      player_id: string;
      role: PlayerRole;
      state: RoomState;
    }) => {
      setBattleSession({
        roomCode: response.room_code,
        playerId: response.player_id,
        role: response.role,
        initialState: response.state,
        finalState: null,
      });
      setView("battle-room");
    },
    [],
  );

  const handleBattleJoined = useCallback(
    (response: {
      room_code: string;
      player_id: string;
      role: PlayerRole;
      state: RoomState;
    }) => {
      setBattleSession({
        roomCode: response.room_code,
        playerId: response.player_id,
        role: response.role,
        initialState: response.state,
        finalState: null,
      });
      setView("battle-room");
    },
    [],
  );

  const handleBattleComplete = useCallback((finalState: RoomState) => {
    setBattleSession((prev) =>
      prev ? { ...prev, finalState, initialState: finalState } : prev,
    );
    setView("battle-result");
  }, []);

  const handleBattlePlayAgain = useCallback(() => {
    setBattleSession(null);
    setView("battle-lobby");
  }, []);

  // --- Session list handlers ---

  const handleDeleteSession = useCallback((sessionId: string) => {
    setHiddenSessionIds((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    console.warn(
      "Delete is local-only — server-side attempts.jsonl is unchanged.",
    );
  }, []);

  const handleViewSession = useCallback(
    (sessionId: string) => {
      const cached = reportCacheResult.get(sessionId);
      if (cached) {
        setReport(cached);
        setDegradedReport(false);
        setView("report");
        return;
      }
      const summary = sessions.find((s) => s.sessionId === sessionId);
      if (!summary) return;
      const fallback: ScoreResult = {
        sessionId: summary.sessionId,
        transcript: "",
        targetText: summary.sentencePreview,
        score:
          typeof summary.score === "number" ? Math.round(summary.score) : 0,
        wordResults: [],
        wpm: 0,
        durationSeconds: summary.durationSeconds ?? 0,
        difficulty: "easy",
        available: summary.available,
      };
      setReport(fallback);
      setDegradedReport(true);
      setView("report");
    },
    [reportCacheResult, sessions],
  );

  const handleSubmitRecording = useCallback(
    async (audio: Blob, sentence: Sentence) => {
      setScoreError(null);
      setView("processing");
      try {
        const { result, raw } = await scoreAudio(audio, sentence);
        setReportCacheRaw((prev) => {
          const next = new Map(prev);
          next.set(result.sessionId, raw);
          return next;
        });
        setReportCacheResult((prev) => {
          const next = new Map(prev);
          next.set(result.sessionId, result);
          return next;
        });
        setReport(result);
        setDegradedReport(false);
        setView("report");
        void refreshSessions();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Scoring failed.";
        setScoreError(message);
        setView("practice");
      }
    },
    [refreshSessions],
  );

  const handleTryAgain = useCallback(() => {
    const filtered = sentences.filter((s) => s.difficulty === difficulty);
    const nextIdx = Math.min(sentenceIdx + 1, Math.max(0, filtered.length - 1));
    setSentenceIdx(nextIdx);
    setView("practice");
  }, [sentences, difficulty, sentenceIdx]);

  const handleChangeDifficulty = useCallback((next: Difficulty) => {
    setDifficulty(next);
    setSentenceIdx(0);
  }, []);

  // --- Render: pre-auth ---

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
        <BackgroundOrbs />
        <LoginView onSignIn={signIn} />
      </div>
    );
  }

  // --- Render: authenticated ---

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
      <BackgroundOrbs />
      <Header
        user={user}
        onSignOut={() => {
          signOut();
          setView("main-menu");
          setBattleSession(null);
        }}
        onLogoClick={handleBackToMenu}
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {sentencesError && view !== "report" && view !== "main-menu" && (
          <div className="mb-6 card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
            Could not load sentences: {sentencesError}
          </div>
        )}
        {scoreError && view === "practice" && (
          <div className="mb-6 card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
            {scoreError}
          </div>
        )}

        {view === "main-menu" && (
          <MainMenuView
            user={user}
            onSelectPronunciation={handleSelectPronunciation}
            onSelectBattle={handleSelectBattle}
            onSelectInterview={handleSelectInterview}
            onSelectFourth={handleSelectFourth}
          />
        )}

        {view === "home" && (
          <HomeView
            sessions={visibleSessions}
            cachedSessionIds={cachedSessionIds}
            bestStreak={bestStreak}
            wordsMastered={wordsMastered}
            onStart={handleStart}
            onStartBattle={handleStartBattleFromHome}
            onView={handleViewSession}
            onDelete={handleDeleteSession}
          />
        )}

        {view === "practice" && (
          <PracticeView
            sentences={sentences}
            difficulty={difficulty}
            onChangeDifficulty={handleChangeDifficulty}
            sentenceIndex={sentenceIdx}
            onChangeSentenceIndex={setSentenceIdx}
            onSubmit={handleSubmitRecording}
            onBack={handleBackToPronunciation}
          />
        )}

        {view === "processing" && <ProcessingView />}

        {view === "report" && report && (
          <ReportView
            report={report}
            degraded={degradedReport}
            onTryAgain={handleTryAgain}
            onHome={handleBackToPronunciation}
          />
        )}

        {view === "battle-lobby" && (
          <BattleLobbyView
            onCreated={handleBattleCreated}
            onJoined={handleBattleJoined}
            onBack={handleBackToMenu}
          />
        )}

        {view === "battle-room" && battleSession && (
          <BattleRoomView
            roomCode={battleSession.roomCode}
            playerId={battleSession.playerId}
            role={battleSession.role}
            initialState={battleSession.initialState}
            onComplete={handleBattleComplete}
            onLeave={handleBackToMenu}
          />
        )}

        {view === "battle-result" &&
          battleSession &&
          battleSession.finalState && (
            <BattleResultView
              state={battleSession.finalState}
              youAre={battleSession.role}
              onPlayAgain={handleBattlePlayAgain}
              onHome={handleBackToMenu}
            />
          )}

        {view === "interview" && (
          <InterviewStudioView onBack={handleBackToMenu} />
        )}

        {view === "cruise" && <SpeedometerView onBack={handleBackToMenu} />}
      </main>

      <footer className="w-full max-w-5xl mx-auto px-4 md:px-6 pb-8 pt-2 text-center text-xs text-zinc-600">
        Soft Skills Studio · KIET communication platform
      </footer>
    </div>
  );
}
