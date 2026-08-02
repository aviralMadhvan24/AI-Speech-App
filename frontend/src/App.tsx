import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AdminPanelView } from "./components/AdminPanelView";
import { AdminReviewView } from "./components/admin/AdminReviewView";
import { AdminStudentDetailView } from "./components/admin/AdminStudentDetailView";
import { BackgroundOrbs } from "./components/BackgroundOrbs";
import { BattleLobbyView } from "./components/BattleLobbyView";
import { BattleResultView } from "./components/BattleResultView";
import {
  BattleRehydrator,
  BattleRoomView,
  type RehydratedBattle,
} from "./components/BattleRoomView";
import { DebateArenaView } from "./components/DebateArenaView";
import { GDArenaView } from "./components/GDArenaView";
import { Header } from "./components/Header";
import { HomeView } from "./components/HomeView";
import { InterviewStudioView } from "./components/InterviewStudioView";
import { MainMenuView } from "./components/MainMenuView";
import { PracticeView } from "./components/PracticeView";
import { ProcessingView } from "./components/ProcessingView";
import { ProfileView } from "./components/ProfileView";
import { ReportView } from "./components/ReportView";
import { RequireAuth } from "./routes/RequireAuth";
import { saveRoomSession, clearRoomSession } from "./lib/roomSession";
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

interface BattleSession {
  roomCode: string;
  playerId: string;
  role: PlayerRole;
  initialState: RoomState | null;
  finalState: RoomState | null;
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function isDifficulty(value: string | null): value is Difficulty {
  return value !== null && (DIFFICULTIES as string[]).includes(value);
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

/** Build a degraded (list-only) report from a session summary. */
function degradedReportFor(summary: SessionPreview): ScoreResult {
  return {
    sessionId: summary.sessionId,
    transcript: "",
    targetText: summary.sentencePreview,
    score: typeof summary.score === "number" ? Math.round(summary.score) : 0,
    wordResults: [],
    wpm: 0,
    durationSeconds: summary.durationSeconds ?? 0,
    difficulty: "easy",
    available: summary.available,
  };
}

// ---------------------------------------------------------------------------
// Route wrapper components
//
// Defined at module scope (not inside `App`) so they keep a stable identity
// across renders and are not remounted on every `App` re-render. Each reads
// its context from the URL (`useParams`/`useSearchParams`) and receives the
// shared data + handlers it needs from `App` via props.
// ---------------------------------------------------------------------------

interface PracticeRouteProps {
  sentences: Sentence[];
  difficulty: Difficulty;
  sentenceIdx: number;
  setDifficulty: (next: Difficulty) => void;
  setSentenceIdx: (next: number) => void;
  onSubmit: (audio: Blob, sentence: Sentence) => Promise<void>;
  onBack: () => void;
}

/**
 * `/practice?difficulty=&i=` — restores difficulty + sentence index from the
 * query on load (Req 2.7) and keeps the URL in sync as the user changes them
 * (via `replace`, so per-sentence navigation does not flood the history).
 */
function PracticeRoute({
  sentences,
  difficulty,
  sentenceIdx,
  setDifficulty,
  setSentenceIdx,
  onSubmit,
  onBack,
}: PracticeRouteProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qDifficulty = searchParams.get("difficulty");
  const qIndex = searchParams.get("i");

  // Sync URL -> state (on load / when the query changes).
  useEffect(() => {
    if (isDifficulty(qDifficulty) && qDifficulty !== difficulty) {
      setDifficulty(qDifficulty);
    }
    const parsed = qIndex === null ? NaN : Number.parseInt(qIndex, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== sentenceIdx) {
      setSentenceIdx(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDifficulty, qIndex]);

  const changeDifficulty = useCallback(
    (next: Difficulty) => {
      setDifficulty(next);
      setSentenceIdx(0);
      navigate(`/practice?difficulty=${next}&i=0`, { replace: true });
    },
    [navigate, setDifficulty, setSentenceIdx],
  );

  const changeIndex = useCallback(
    (next: number) => {
      setSentenceIdx(next);
      navigate(`/practice?difficulty=${difficulty}&i=${next}`, {
        replace: true,
      });
    },
    [navigate, difficulty, setSentenceIdx],
  );

  return (
    <PracticeView
      sentences={sentences}
      difficulty={difficulty}
      onChangeDifficulty={changeDifficulty}
      sentenceIndex={sentenceIdx}
      onChangeSentenceIndex={changeIndex}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  );
}

interface ReportRouteProps {
  reportCacheResult: Map<string, ScoreResult>;
  sessions: SessionPreview[];
  report: ScoreResult | null;
  degradedReport: boolean;
  onTryAgain: () => void;
  onHome: () => void;
}

/**
 * `/report/:sessionId` — resolves the report from the in-memory cache; falls
 * back to the last-viewed report in state, then to a degraded (list-only)
 * report derived from the session summary (Req 2.5). If nothing is resolvable
 * (e.g. an unknown id), redirects to the pronunciation home rather than
 * crashing.
 */
function ReportRoute({
  reportCacheResult,
  sessions,
  report,
  degradedReport,
  onTryAgain,
  onHome,
}: ReportRouteProps) {
  const { sessionId } = useParams();

  const resolved = useMemo(() => {
    if (!sessionId) return null;
    const cached = reportCacheResult.get(sessionId);
    if (cached) return { report: cached, degraded: false };
    if (report && report.sessionId === sessionId) {
      return { report, degraded: degradedReport };
    }
    const summary = sessions.find((s) => s.sessionId === sessionId);
    if (summary) return { report: degradedReportFor(summary), degraded: true };
    return null;
  }, [sessionId, reportCacheResult, sessions, report, degradedReport]);

  if (!resolved) return <Navigate to="/pronunciation" replace />;

  return (
    <ReportView
      report={resolved.report}
      degraded={resolved.degraded}
      onTryAgain={onTryAgain}
      onHome={onHome}
    />
  );
}

interface BattleRoomRouteProps {
  battleSession: BattleSession | null;
  onRehydrated: (data: RehydratedBattle) => void;
  onComplete: (finalState: RoomState) => void;
  onLeave: () => void;
}

/**
 * `/battle/:code` — renders the live battle room from the in-memory session.
 * On a reload/deep-link the session is gone; `BattleRehydrator` recovers the
 * player identity from the room-session store + re-fetches the room snapshot
 * and reseeds the session via `onRehydrated` (Req 2.3). Missing identity / a
 * stale room degrade to the lobby with a message (Req 2.10).
 */
function BattleRoomRoute({
  battleSession,
  onRehydrated,
  onComplete,
  onLeave,
}: BattleRoomRouteProps) {
  const { code } = useParams();
  if (!code) return <Navigate to="/battle" replace />;
  if (!battleSession || battleSession.roomCode !== code) {
    return <BattleRehydrator code={code} onRehydrated={onRehydrated} />;
  }
  return (
    <BattleRoomView
      roomCode={battleSession.roomCode}
      playerId={battleSession.playerId}
      role={battleSession.role}
      initialState={battleSession.initialState}
      onComplete={onComplete}
      onLeave={onLeave}
    />
  );
}

interface BattleResultRouteProps {
  battleSession: BattleSession | null;
  onRehydrated: (data: RehydratedBattle) => void;
  onPlayAgain: () => void;
  onHome: () => void;
}

/**
 * `/battle/:code/result` — renders the completed-battle summary. On reload the
 * session is reused from memory, else `BattleRehydrator` re-fetches the room
 * and reseeds it (Req 2.3); a still-running match is redirected to the live
 * room, and a stale room degrades to the lobby (Req 2.10).
 */
function BattleResultRoute({
  battleSession,
  onRehydrated,
  onPlayAgain,
  onHome,
}: BattleResultRouteProps) {
  const { code } = useParams();
  if (!code) return <Navigate to="/battle" replace />;
  if (
    !battleSession ||
    battleSession.roomCode !== code ||
    !battleSession.finalState
  ) {
    return (
      <BattleRehydrator code={code} onRehydrated={onRehydrated} requireComplete />
    );
  }
  return (
    <BattleResultView
      state={battleSession.finalState}
      youAre={battleSession.role}
      onPlayAgain={onPlayAgain}
      onHome={onHome}
    />
  );
}

/**
 * `/processing` — the transient scoring screen. It is only meaningful while a
 * score request is in flight; on a direct load/reload (`scoring === false`) we
 * redirect to `/practice` because in-flight scoring cannot be restored.
 */
function ProcessingRoute({ scoring }: { scoring: boolean }) {
  if (!scoring) return <Navigate to="/practice" replace />;
  return <ProcessingView />;
}

interface AdminReviewRouteProps {
  onBack: () => void;
}

/** `/admin/review/:submissionId` — passes the id straight through (Req 2.6). */
function AdminReviewRoute({ onBack }: AdminReviewRouteProps) {
  const { submissionId } = useParams();
  if (!submissionId) return <Navigate to="/admin" replace />;
  return (
    <AdminReviewView
      submissionId={submissionId}
      onBack={onBack}
      onReviewed={onBack}
    />
  );
}

interface AdminStudentRouteProps {
  onBack: () => void;
}

/** `/admin/student/:email` — decodes the URL-encoded email (Req 2.6). */
function AdminStudentRoute({ onBack }: AdminStudentRouteProps) {
  const { email } = useParams();
  if (!email) return <Navigate to="/admin" replace />;
  return (
    <AdminStudentDetailView email={decodeURIComponent(email)} onBack={onBack} />
  );
}

export default function App() {
  const { user, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [sentencesError, setSentencesError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [report, setReport] = useState<ScoreResult | null>(null);
  const [degradedReport, setDegradedReport] = useState(false);
  const [scoring, setScoring] = useState(false);
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
    // Leaving a battle also clears its stored identity so a later deep-link
    // does not silently rejoin an abandoned room (design: clear on leave).
    if (battleSession) clearRoomSession("battle", battleSession.roomCode);
    setBattleSession(null);
    navigate("/");
  }, [navigate, battleSession]);

  const handleBackToPronunciation = useCallback(() => {
    navigate("/pronunciation");
  }, [navigate]);

  const handleSelectPronunciation = useCallback(() => {
    navigate("/pronunciation");
  }, [navigate]);

  const handleSelectBattle = useCallback(() => {
    setBattleSession(null);
    navigate("/battle");
  }, [navigate]);

  const handleSelectInterview = useCallback(() => {
    navigate("/interview");
  }, [navigate]);

  const handleSelectDebate = useCallback(() => {
    navigate("/debate");
  }, [navigate]);

  const handleSelectGD = useCallback(() => {
    navigate("/gd");
  }, [navigate]);

  const handleSelectAdmin = useCallback(() => {
    navigate("/admin");
  }, [navigate]);

  const handleSelectProfile = useCallback(() => {
    navigate("/profile");
  }, [navigate]);

  const handleOpenReview = useCallback(
    (submissionId: string) => {
      navigate(`/admin/review/${submissionId}`);
    },
    [navigate],
  );

  const handleOpenStudent = useCallback(
    (email: string) => {
      navigate(`/admin/student/${encodeURIComponent(email)}`);
    },
    [navigate],
  );

  const handleBackToAdminPanel = useCallback(() => {
    navigate("/admin");
  }, [navigate]);

  const handleStart = useCallback(() => {
    setSentenceIdx(0);
    navigate(`/practice?difficulty=${difficulty}&i=0`);
  }, [navigate, difficulty]);

  // Kept for HomeView compatibility — its shortcut button still works.
  const handleStartBattleFromHome = useCallback(() => {
    setBattleSession(null);
    navigate("/battle");
  }, [navigate]);

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
      saveRoomSession("battle", response.room_code, {
        playerId: response.player_id,
        role: response.role,
        savedAt: Date.now(),
      });
      navigate(`/battle/${response.room_code}`);
    },
    [navigate],
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
      saveRoomSession("battle", response.room_code, {
        playerId: response.player_id,
        role: response.role,
        savedAt: Date.now(),
      });
      navigate(`/battle/${response.room_code}`);
    },
    [navigate],
  );

  const handleBattleComplete = useCallback(
    (finalState: RoomState) => {
      let code: string | null = null;
      setBattleSession((prev) => {
        if (!prev) return prev;
        code = prev.roomCode;
        return { ...prev, finalState, initialState: finalState };
      });
      if (code) navigate(`/battle/${code}/result`);
    },
    [navigate],
  );

  const handleBattlePlayAgain = useCallback(() => {
    if (battleSession) clearRoomSession("battle", battleSession.roomCode);
    setBattleSession(null);
    navigate("/battle");
  }, [navigate, battleSession]);

  // Reseed the in-memory battle session after a reload/deep-link recovery.
  // `finalState` is only set for a finished match so the result route renders
  // and the live room route stays live (Req 2.3).
  const handleBattleRehydrated = useCallback((data: RehydratedBattle) => {
    setBattleSession({
      roomCode: data.roomCode,
      playerId: data.playerId,
      role: data.role,
      initialState: data.state,
      finalState: data.state.status === "complete" ? data.state : null,
    });
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
      } else {
        const summary = sessions.find((s) => s.sessionId === sessionId);
        if (!summary) return;
        setReport(degradedReportFor(summary));
        setDegradedReport(true);
      }
      navigate(`/report/${sessionId}`);
    },
    [navigate, reportCacheResult, sessions],
  );

  const handleSubmitRecording = useCallback(
    async (audio: Blob, sentence: Sentence) => {
      setScoreError(null);
      setScoring(true);
      navigate("/processing");
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
        setScoring(false);
        navigate(`/report/${result.sessionId}`);
        void refreshSessions();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scoring failed.";
        setScoreError(message);
        setScoring(false);
        navigate(`/practice?difficulty=${difficulty}&i=${sentenceIdx}`);
      }
    },
    [navigate, refreshSessions, difficulty, sentenceIdx],
  );

  const handleTryAgain = useCallback(() => {
    const filtered = sentences.filter((s) => s.difficulty === difficulty);
    const nextIdx = Math.min(sentenceIdx + 1, Math.max(0, filtered.length - 1));
    setSentenceIdx(nextIdx);
    navigate(`/practice?difficulty=${difficulty}&i=${nextIdx}`);
  }, [navigate, sentences, difficulty, sentenceIdx]);

  // --- Derived chrome flags (replace the old `view` comparisons) ---

  const path = location.pathname;
  const isMainMenu = path === "/";
  const isReport = path.startsWith("/report");
  const isPractice = path === "/practice";

  return (
    <RequireAuth>
      {user && (
        <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
          <BackgroundOrbs />
          <Header
            user={user}
            onSignOut={() => {
              void signOut();
              setBattleSession(null);
              navigate("/");
            }}
            onLogoClick={handleBackToMenu}
          />

          <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-12">
            {sentencesError && !isReport && !isMainMenu && (
              <div className="mb-6 card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
                Could not load sentences: {sentencesError}
              </div>
            )}
            {scoreError && isPractice && (
              <div className="mb-6 card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
                {scoreError}
              </div>
            )}

            <Routes>
              <Route
                path="/"
                element={
                  <MainMenuView
                    user={user}
                    showAdmin={user.role === "teacher"}
                    onSelectPronunciation={handleSelectPronunciation}
                    onSelectBattle={handleSelectBattle}
                    onSelectInterview={handleSelectInterview}
                    onSelectDebate={handleSelectDebate}
                    onSelectGD={handleSelectGD}
                    onSelectAdmin={handleSelectAdmin}
                    onSelectProfile={handleSelectProfile}
                  />
                }
              />

              <Route
                path="/pronunciation"
                element={
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
                }
              />

              <Route
                path="/practice"
                element={
                  <PracticeRoute
                    sentences={sentences}
                    difficulty={difficulty}
                    sentenceIdx={sentenceIdx}
                    setDifficulty={setDifficulty}
                    setSentenceIdx={setSentenceIdx}
                    onSubmit={handleSubmitRecording}
                    onBack={handleBackToPronunciation}
                  />
                }
              />

              <Route
                path="/processing"
                element={<ProcessingRoute scoring={scoring} />}
              />

              <Route
                path="/report/:sessionId"
                element={
                  <ReportRoute
                    reportCacheResult={reportCacheResult}
                    sessions={sessions}
                    report={report}
                    degradedReport={degradedReport}
                    onTryAgain={handleTryAgain}
                    onHome={handleBackToPronunciation}
                  />
                }
              />

              <Route
                path="/battle"
                element={
                  <BattleLobbyView
                    onCreated={handleBattleCreated}
                    onJoined={handleBattleJoined}
                    onBack={handleBackToMenu}
                  />
                }
              />

              <Route
                path="/battle/:code"
                element={
                  <BattleRoomRoute
                    battleSession={battleSession}
                    onRehydrated={handleBattleRehydrated}
                    onComplete={handleBattleComplete}
                    onLeave={handleBackToMenu}
                  />
                }
              />

              <Route
                path="/battle/:code/result"
                element={
                  <BattleResultRoute
                    battleSession={battleSession}
                    onRehydrated={handleBattleRehydrated}
                    onPlayAgain={handleBattlePlayAgain}
                    onHome={handleBackToMenu}
                  />
                }
              />

              <Route
                path="/interview"
                element={<InterviewStudioView onBack={handleBackToMenu} />}
              />
              <Route
                path="/interview/:submissionId"
                element={<InterviewStudioView onBack={handleBackToMenu} />}
              />

              <Route
                path="/debate/:code?"
                element={<DebateArenaView onBack={handleBackToMenu} />}
              />
              <Route
                path="/gd/:code?"
                element={<GDArenaView onBack={handleBackToMenu} />}
              />

              <Route
                path="/admin"
                element={
                  <AdminPanelView
                    onBack={handleBackToMenu}
                    onOpenReview={handleOpenReview}
                    onOpenStudent={handleOpenStudent}
                  />
                }
              />
              <Route
                path="/admin/review/:submissionId"
                element={<AdminReviewRoute onBack={handleBackToAdminPanel} />}
              />
              <Route
                path="/admin/student/:email"
                element={<AdminStudentRoute onBack={handleBackToAdminPanel} />}
              />

              <Route
                path="/profile"
                element={
                  <ProfileView
                    user={user}
                    onBack={handleBackToMenu}
                    onAvatarChange={refreshProfile}
                  />
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer className="w-full max-w-5xl mx-auto px-4 md:px-6 pb-8 pt-2 text-center text-xs text-zinc-600">
            Soft Skills Studio · KIET communication platform
          </footer>
        </div>
      )}
    </RequireAuth>
  );
}
