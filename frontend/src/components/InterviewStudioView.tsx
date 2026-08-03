import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  Eye,
  Hand,
  Loader2,
  PersonStanding,
  Play,
  RefreshCw,
  Send,
  Smile,
  Sparkles,
  Square,
  Trophy,
  UserCheck,
  Video,
} from "lucide-react";
import {
  analyzeInterview,
  fetchMySubmission,
  fetchMySubmissions,
  scoreInterviewAnswer,
  submitInterviewForReview,
  type InterviewContentResult,
  type InterviewGestureMetric,
  type StudentSubmissionSummary,
} from "../api";
import { relativeTime } from "../utils/time";

interface InterviewStudioViewProps {
  onBack: () => void;
}

type Stage = "pick" | "record" | "analyze" | "submitted" | "complete";

interface InterviewQuestion {
  id: string;
  category: "behavioural" | "technical" | "situational";
  prompt: string;
  hint: string;
}

interface GestureScore {
  key: string;
  label: string;
  value: number;
  icon: typeof Eye;
  blurb: string;
  flag: string;
}

const METRIC_META: Record<
  string,
  { label: string; icon: typeof Eye; blurb: string }
> = {
  posture: {
    label: "Posture",
    icon: PersonStanding,
    blurb: "Upright shoulders and head alignment. Avoid slouching forward.",
  },
  eye_contact: {
    label: "Eye Contact",
    icon: Eye,
    blurb: "Steady gaze on camera reads as confident.",
  },
  gesture: {
    label: "Hand Gestures",
    icon: Hand,
    blurb: "Open, purposeful hand motion adds energy without distracting.",
  },
  stillness: {
    label: "Stillness",
    icon: Sparkles,
    blurb: "Calm body, minimal fidgeting. Less is more.",
  },
  facial_expression: {
    label: "Facial Expression",
    icon: Smile,
    blurb: "Micro-expressions stay engaged. Smile when introducing a story.",
  },
};

function gestureScoresFromMetrics(metrics: InterviewGestureMetric[]): GestureScore[] {
  return metrics.map((m) => {
    const meta = METRIC_META[m.name] ?? {
      label: m.name.replace(/_/g, " "),
      icon: Sparkles,
      blurb: "Body language metric reported by the gesture analyzer.",
    };
    return {
      key: m.name,
      label: meta.label,
      icon: meta.icon,
      blurb: meta.blurb,
      value: typeof m.score === "number" ? m.score : 0,
      flag: m.flag || "ok",
    };
  });
}

interface TeacherRubricItem {
  key: string;
  label: string;
  score: number;
  out_of: number;
  comment: string;
}

const QUESTIONS: InterviewQuestion[] = [
  {
    id: "q-strength",
    category: "behavioural",
    prompt: "Walk me through a project you led — what went well, what would you do differently?",
    hint: "Use STAR: Situation, Task, Action, Result. Keep it under 90 seconds.",
  },
  {
    id: "q-conflict",
    category: "situational",
    prompt: "Tell me about a time you disagreed with a teammate. How did you resolve it?",
    hint: "Show empathy, listening, and the path to a shared outcome.",
  },
  {
    id: "q-systems",
    category: "technical",
    prompt: "Explain how you'd design a URL shortener at college-scale.",
    hint: "Address storage, hash collisions, redirects, and rate limiting in one minute.",
  },
  {
    id: "q-feedback",
    category: "behavioural",
    prompt: "Describe the most useful feedback you've received this year.",
    hint: "Self-awareness + action. Avoid blaming anyone.",
  },
];

const CATEGORY_LABEL: Record<InterviewQuestion["category"], string> = {
  behavioural: "Behavioural",
  technical: "Technical",
  situational: "Situational",
};



// Rubric labels + comment fallback for when we render a real teacher review.
const RUBRIC_META: Array<{
  key: "structure" | "clarity" | "evidence" | "presence";
  label: string;
}> = [
  { key: "structure", label: "Structure & STAR" },
  { key: "clarity", label: "Clarity of Thought" },
  { key: "evidence", label: "Evidence & Specifics" },
  { key: "presence", label: "Presence" },
];

function reviewToRubricItems(
  rubric: { structure: number; clarity: number; evidence: number; presence: number },
  comment: string,
): TeacherRubricItem[] {
  return RUBRIC_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    score: rubric[meta.key],
    out_of: 10,
    // Only the first item shows the free-form comment so the UI stays clean.
    comment: meta.key === "structure" && comment ? comment : "",
  }));
}

function classifyScore(value: number): {
  label: string;
  textClass: string;
  badgeClass: string;
} {
  if (value >= 85)
    return {
      label: "Excellent",
      textClass: "text-emerald-300",
      badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    };
  if (value >= 70)
    return {
      label: "Good",
      textClass: "text-brand-300",
      badgeClass: "bg-brand-500/10 border-brand-500/30 text-brand-300",
    };
  if (value >= 55)
    return {
      label: "Practice",
      textClass: "text-amber-300",
      badgeClass: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    };
  return {
    label: "Needs Work",
    textClass: "text-rose-300",
    badgeClass: "bg-rose-500/10 border-rose-500/30 text-rose-300",
  };
}

export function InterviewStudioView({ onBack }: InterviewStudioViewProps) {
  const navigate = useNavigate();
  // `/interview/:submissionId` resumes a submitted/complete submission on
  // reload (Req 2.4). `/interview` (no param) is the entry / pick stage — the
  // mid-capture stages (record/analyze) are not URL-encodable, so a reload
  // there lands here rather than on main-menu.
  const { submissionId: routeSubmissionId } = useParams();

  const [stage, setStage] = useState<Stage>("pick");
  const [questionIdx, setQuestionIdx] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedTimerRef = useRef<number | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // MediaRecorder bits
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);

  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [gestureScores, setGestureScores] = useState<GestureScore[]>([]);
  // AI content score for the spoken answer (relevance/structure/depth/comm).
  // Runs alongside gesture analysis; independent so one failing never blocks
  // the other.
  const [contentResult, setContentResult] = useState<InterviewContentResult | null>(null);
  const [teacherRubric, setTeacherRubric] = useState<TeacherRubricItem[]>([]);
  const [teacherComment, setTeacherComment] = useState<string>("");
  const [pollAttempts, setPollAttempts] = useState<number>(0);

  // Bookkeeping for the review poll — we ping /interview/my-submissions/{id}
  // every 5 seconds until the teacher posts a review, then transition to
  // the completed stage with real rubric data.
  const submissionIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  // "Your submissions" panel on the pick screen: student can jump back into
  // a pending submission (resume polling) or open a reviewed one (see the
  // real combined score + teacher rubric).
  const [mySubmissions, setMySubmissions] = useState<StudentSubmissionSummary[]>([]);
  const [mySubmissionsLoading, setMySubmissionsLoading] = useState(false);
  const [mySubmissionsError, setMySubmissionsError] = useState<string | null>(null);

  const stopReviewPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applyReviewIfPresent = useCallback(async (submissionId: string): Promise<boolean> => {
    try {
      const detail = await fetchMySubmission(submissionId);
      if (detail.review) {
        setTeacherRubric(reviewToRubricItems(detail.review.rubric, detail.review.comment));
        setTeacherComment(detail.review.comment);
        setStage("complete");
        stopReviewPolling();
        return true;
      }
    } catch (err) {
      // Networking hiccups shouldn't kill the poll — surface via error log
      // and try again on the next tick.
      console.warn("review poll failed", err);
    }
    return false;
  }, [stopReviewPolling]);

  const startReviewPolling = useCallback(
    (submissionId: string) => {
      stopReviewPolling();
      setPollAttempts(0);

      // Kick off an immediate check so the "reviewed while UI was closed"
      // case resolves instantly instead of waiting the first 5 seconds.
      void applyReviewIfPresent(submissionId);

      pollTimerRef.current = window.setInterval(() => {
        setPollAttempts((n) => n + 1);
        void applyReviewIfPresent(submissionId);
      }, 5000);
    },
    [applyReviewIfPresent, stopReviewPolling],
  );

  // Stop polling if the component unmounts (user navigates away etc).
  useEffect(() => {
    return () => stopReviewPolling();
  }, [stopReviewPolling]);

  // Refresh the student's submissions list whenever they return to the pick
  // stage. Runs on mount and every time the user hits "Restart"/back-to-menu
  // and re-enters the studio.
  const refreshMySubmissions = useCallback(async () => {
    setMySubmissionsLoading(true);
    setMySubmissionsError(null);
    try {
      const items = await fetchMySubmissions();
      setMySubmissions(items);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not load your submissions.";
      setMySubmissionsError(message);
    } finally {
      setMySubmissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stage === "pick") {
      void refreshMySubmissions();
    }
  }, [stage, refreshMySubmissions]);

  // Jump into an existing submission from the "Your submissions" panel.
  // Reviewed → transitions to complete with the real rubric.
  // Pending → transitions to submitted and resumes polling.
  const openMySubmission = useCallback(
    async (submissionId: string, opts?: { syncUrl?: boolean }) => {
      submissionIdRef.current = submissionId;
      // Reflect the opened submission in the URL so a reload restores it
      // (Req 2.4). Skip when we are already resuming from that route param, to
      // avoid pushing a duplicate history entry.
      if (opts?.syncUrl !== false) {
        navigate(`/interview/${submissionId}`);
      }
      try {
        const detail = await fetchMySubmission(submissionId);
        // Rebuild the per-metric card list so the complete/submitted screens
        // render the same body-language breakdown the student saw at analyze
        // time, without re-running the video through ss3.
        setGestureScores(gestureScoresFromMetrics(detail.gestureMetrics));
        // Content score isn't persisted on the submission record, so it can't
        // be reconstructed when reopening a past submission — clear it.
        setContentResult(null);
        elapsedAtAnalyzeRef.current = Math.round(detail.durationSeconds);
        gestureSessionIdRef.current = null; // video already stored in ss3 by session id

        if (detail.review) {
          setTeacherRubric(
            reviewToRubricItems(detail.review.rubric, detail.review.comment),
          );
          setTeacherComment(detail.review.comment);
          setStage("complete");
          stopReviewPolling();
        } else {
          setTeacherRubric([]);
          setTeacherComment("");
          setStage("submitted");
          startReviewPolling(submissionId);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not open submission.";
        setMySubmissionsError(message);
      }
    },
    [startReviewPolling, stopReviewPolling, navigate],
  );

  // Resume from `/interview/:submissionId` on mount (Req 2.4). Runs once per
  // submission id; `syncUrl: false` because the URL already reflects it.
  const resumedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!routeSubmissionId) return;
    if (resumedIdRef.current === routeSubmissionId) return;
    resumedIdRef.current = routeSubmissionId;
    void openMySubmission(routeSubmissionId, { syncUrl: false });
  }, [routeSubmissionId, openMySubmission]);

  // Captured from the real /interview/analyze response so the later
  // submit-for-review call can reference the gesture session by id.
  const gestureSessionIdRef = useRef<string | null>(null);
  const elapsedAtAnalyzeRef = useRef<number>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const question = QUESTIONS[questionIdx] ?? QUESTIONS[0]!;

  // Attach stream to <video> element when it arrives.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Cleanup stream + timers on unmount.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
      if (elapsedTimerRef.current !== null) {
        window.clearInterval(elapsedTimerRef.current);
      }
    };
  }, [stream]);

  const startCamera = useCallback(async () => {
    setRecordingError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      setStream(next);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not access camera.";
      setRecordingError(`Camera unavailable: ${message}`);
    }
  }, []);

  const handlePick = useCallback(
    (idx: number) => {
      setQuestionIdx(idx);
      setStage("record");
      void startCamera();
    },
    [startCamera],
  );

  function pickRecorderMimeType(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return undefined;
  }

  const startRecording = useCallback(() => {
    if (!stream) return;
    recordedBlobRef.current = null;
    chunksRef.current = [];
    setRecordingError(null);

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      setRecordingError(
        err instanceof Error ? err.message : "Could not start recorder",
      );
      return;
    }

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const finalType = recorder.mimeType || mimeType || "video/webm";
      recordedBlobRef.current = new Blob(chunksRef.current, { type: finalType });
      chunksRef.current = [];
    };

    recorderRef.current = recorder;
    recorder.start(500);
    setIsRecording(true);
    setElapsed(0);
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
    }
    const startedAt = Date.now();
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }, [stream]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    setIsRecording(false);
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return recordedBlobRef.current;
    }
    return await new Promise<Blob | null>((resolve) => {
      const originalOnStop = recorder.onstop;
      recorder.onstop = (event) => {
        if (originalOnStop) {
          originalOnStop.call(recorder, event);
        }
        resolve(recordedBlobRef.current);
      };
      try {
        recorder.stop();
      } catch {
        resolve(recordedBlobRef.current);
      }
    });
  }, []);

  const beginAnalysis = useCallback(async () => {
    const blob = await stopRecording();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setAnalyzeProgress(0);
    setAnalyzeError(null);
    setGestureScores([]);
    setContentResult(null);
    setStage("analyze");

    if (!blob || blob.size === 0) {
      setAnalyzeError(
        "No video was captured. Try again — keep the recording button pressed for a few seconds.",
      );
      return;
    }

    // Kick off AI content scoring in parallel (fire-and-forget). Whisper
    // reads the audio track of the same recording. Failures are non-fatal —
    // gesture analysis and teacher review still work without it.
    void scoreInterviewAnswer(blob, question.prompt, question.category)
      .then((res) => setContentResult(res))
      .catch((err) => {
        console.warn("interview content scoring failed", err);
        setContentResult(null);
      });

    // Indeterminate progress driver — actual call duration is unknown
    // (ss3 polling takes 10-30 s on CPU). The bar fakes asymptotic progress
    // up to 95% and snaps to 100% once the API returns.
    const startedAt = Date.now();
    const ramp = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      // Approaches 95 as elapsedMs grows; never quite gets there.
      const pct = Math.min(95, Math.round(95 * (1 - Math.exp(-elapsedMs / 8000))));
      setAnalyzeProgress(pct);
    }, 150);

    try {
      const result = await analyzeInterview(blob);
      gestureSessionIdRef.current = result.sessionId ?? null;
      elapsedAtAnalyzeRef.current = Math.max(
        0,
        Math.round(result.durationSeconds),
      );
      setGestureScores(gestureScoresFromMetrics(result.metrics));
      setAnalyzeProgress(100);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gesture analysis failed";
      setAnalyzeError(message);
    } finally {
      window.clearInterval(ramp);
    }
  }, [stream, stopRecording, question]);

  const submitForReview = useCallback(async () => {
    setSubmitError(null);
    setStage("submitted");
    try {
      const gestureAvg =
        gestureScores.length === 0
          ? 0
          : Math.round(
              gestureScores.reduce((sum, g) => sum + g.value, 0) /
                gestureScores.length,
            );
      const { submissionId } = await submitInterviewForReview({
        sessionId: gestureSessionIdRef.current ?? "",
        questionId: question.id,
        questionPrompt: question.prompt,
        questionCategory: question.category,
        gestureScore: gestureAvg,
        metrics: gestureScores.map((g) => ({
          name: g.key,
          score: g.value,
          flag: g.flag,
        })),
        durationSeconds: elapsedAtAnalyzeRef.current,
      });
      submissionIdRef.current = submissionId;
      // Reflect the new submission in the URL so a reload restores it (Req 2.4).
      resumedIdRef.current = submissionId;
      navigate(`/interview/${submissionId}`);
      // Start polling the backend every few seconds. When a teacher reviews
      // the submission via the admin panel, the poll will pick it up and
      // transition to the completed screen with real scores.
      startReviewPolling(submissionId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not submit for review.";
      setSubmitError(message);
      setStage("analyze");
    }
  }, [gestureScores, question, navigate, startReviewPolling]);

  const handleRestart = useCallback(() => {
    // Drop back to the entry URL so a reload lands on the pick stage rather
    // than re-resuming the just-finished submission (Req 2.4).
    resumedIdRef.current = null;
    if (routeSubmissionId) navigate("/interview");
    setStage("pick");
    setQuestionIdx(0);
    setIsRecording(false);
    setElapsed(0);
    setGestureScores([]);
    setContentResult(null);
    setTeacherRubric([]);
    setAnalyzeProgress(0);
    setAnalyzeError(null);
    setSubmitError(null);
    setTeacherComment("");
    setPollAttempts(0);
    gestureSessionIdRef.current = null;
    submissionIdRef.current = null;
    elapsedAtAnalyzeRef.current = 0;
    recordedBlobRef.current = null;
    chunksRef.current = [];
    stopReviewPolling();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, [stream, navigate, routeSubmissionId, stopReviewPolling]);

  const gestureAverage = useMemo(() => {
    if (gestureScores.length === 0) return 0;
    return Math.round(
      gestureScores.reduce((sum, item) => sum + item.value, 0) /
        gestureScores.length,
    );
  }, [gestureScores]);

  const teacherTotal = useMemo(
    () => teacherRubric.reduce((sum, item) => sum + item.score, 0),
    [teacherRubric],
  );
  const teacherOutOf = useMemo(
    () => teacherRubric.reduce((sum, item) => sum + item.out_of, 0),
    [teacherRubric],
  );
  const teacherAverage = teacherOutOf > 0
    ? Math.round((teacherTotal / teacherOutOf) * 100)
    : 0;

  const finalScore = useMemo(() => {
    if (stage !== "complete") return 0;
    // 50/50 weighting between AI gesture and teacher rubric.
    return Math.round(gestureAverage * 0.5 + teacherAverage * 0.5);
  }, [stage, gestureAverage, teacherAverage]);

  const finalVerdict = classifyScore(finalScore);

  // ----- Render -----

  return (
    <div key="interview-studio" className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2"
          aria-label="Back to main menu"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
          <Briefcase className="w-3.5 h-3.5" />
          <span>Phase 3 · Preview</span>
        </div>
      </div>

      <header className="card-glass relative overflow-hidden p-6 md:p-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-amber-500/25 via-orange-500/15 to-transparent blur-3xl"
        />
        <div className="relative">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Interview{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 animate-gradient-shift bg-[length:200%_200%]">
              Studio
            </span>
          </h1>
          <p className="mt-2 text-zinc-400 text-sm md:text-base max-w-2xl leading-relaxed">
            Record a video answer. Our AI scores your body language. A teacher
            reviews and grades the content. Your final score blends both.
          </p>
          <Stepper stage={stage} />
        </div>
      </header>

      {stage === "pick" && mySubmissions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-zinc-400">
              Your submissions
            </div>
            <button
              type="button"
              onClick={() => void refreshMySubmissions()}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition"
              aria-label="Refresh submissions list"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${mySubmissionsLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mySubmissions.map((sub, idx) => {
              const isReviewed = sub.status === "reviewed";
              const primaryScore =
                isReviewed && sub.combinedScore != null
                  ? sub.combinedScore
                  : sub.gestureScore;
              const primaryLabel = isReviewed ? "Combined" : "Gesture";
              return (
                <button
                  key={sub.submissionId}
                  type="button"
                  onClick={() => void openMySubmission(sub.submissionId)}
                  style={{ animationDelay: `${idx * 60}ms` }}
                  className="card-glass text-left p-4 md:p-5 hover:-translate-y-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 animate-fade-in-up"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {isReviewed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-full px-2 py-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                            Reviewed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-full px-2 py-0.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Pending
                          </span>
                        )}
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                          {relativeTime(sub.submittedAt)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-zinc-100 line-clamp-2 leading-snug">
                        {sub.questionPrompt}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-2xl font-bold tabular-nums ${classifyScore(primaryScore).textClass}`}
                      >
                        {primaryScore}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                        {primaryLabel}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {mySubmissionsError && (
            <p className="text-xs text-rose-300">{mySubmissionsError}</p>
          )}
        </section>
      )}

      {stage === "pick" && (
        <section className="space-y-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-400">
            Pick a question to answer
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {QUESTIONS.map((q, idx) => (
              <button
                key={q.id}
                type="button"
                onClick={() => handlePick(idx)}
                style={{ animationDelay: `${idx * 60}ms` }}
                className="text-left card-glass p-5 md:p-6 hover:-translate-y-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 animate-fade-in-up"
              >
                <span className="inline-block text-[10px] uppercase tracking-widest font-medium bg-zinc-800/80 text-zinc-300 px-2 py-0.5 rounded">
                  {CATEGORY_LABEL[q.category]}
                </span>
                <p className="mt-3 text-lg font-semibold text-zinc-100 leading-snug">
                  {q.prompt}
                </p>
                <p className="mt-2 text-xs text-zinc-500">{q.hint}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {stage === "record" && (
        <section className="space-y-5">
          <div className="card-glass p-5 md:p-6">
            <div className="text-[10px] uppercase tracking-widest text-zinc-400 mb-2">
              Question
            </div>
            <p className="text-lg md:text-xl font-semibold text-zinc-100 leading-snug">
              {question.prompt}
            </p>
            <p className="mt-2 text-sm text-zinc-500">{question.hint}</p>
          </div>

          <div className="card-glass relative overflow-hidden p-3">
            <div className="aspect-video w-full rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/70 relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover [transform:scaleX(-1)]"
              />
              {!stream && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
                  <span className="inline-flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    Waiting for camera permission…
                  </span>
                </div>
              )}
              {isRecording && (
                <div className="absolute top-3 left-3 inline-flex items-center gap-2 bg-rose-600/90 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-glow-rose-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                  REC · {formatElapsed(elapsed)}
                </div>
              )}
            </div>
          </div>

          {recordingError && (
            <div className="card-glass border-rose-500/40 px-4 py-3 text-sm text-rose-300">
              {recordingError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!isRecording ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={!stream}
                className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                Start recording
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="btn-danger inline-flex items-center gap-2 px-5 py-2.5"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            )}

            <button
              type="button"
              onClick={beginAnalysis}
              disabled={isRecording || elapsed < 3}
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              I'm done — analyze
            </button>

            <button
              type="button"
              onClick={handleRestart}
              className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5"
            >
              <RefreshCw className="w-4 h-4" />
              Different question
            </button>
          </div>

          <p className="text-xs text-zinc-500">
            Tip: speak for 30–90 seconds. The AI analyses are simulated in this
            preview; once the real backend lands, the same UI gets live MediaPipe
            scores.
          </p>
        </section>
      )}

      {stage === "analyze" && (
        <section className="card-glass p-8 md:p-12 text-center space-y-5">
          {!analyzeError && analyzeProgress < 100 && (
            <Loader2 className="w-10 h-10 text-amber-300 animate-spin mx-auto" />
          )}
          <div>
            <h2 className="text-2xl font-semibold text-zinc-100">
              {analyzeError
                ? "Analysis failed"
                : analyzeProgress === 100
                  ? "Body language summary"
                  : "Analysing your body language"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Posture · eye contact · gestures · stillness · expression
            </p>
          </div>

          {!analyzeError && (
            <div className="max-w-md mx-auto">
              <div className="h-2 rounded-full bg-zinc-900/80 border border-zinc-800/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 transition-[width] duration-150"
                  style={{ width: `${analyzeProgress}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-zinc-500 tabular-nums">
                {analyzeProgress}%
              </div>
            </div>
          )}

          {analyzeError && (
            <>
              <div className="mx-auto max-w-md card-glass border-rose-500/40 px-4 py-3 text-sm text-rose-300 text-left">
                {analyzeError}
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="btn-ghost inline-flex items-center gap-2 px-4 py-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try a different question
                </button>
              </div>
              <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                Tip: make sure the gesture-analysis microservice is running on
                <code className="text-zinc-300"> http://localhost:8001</code>.
                See <code className="text-zinc-300">README</code> for the conda
                setup.
              </p>
            </>
          )}

          {!analyzeError && analyzeProgress === 100 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-left max-w-3xl mx-auto">
                {gestureScores.map((g, index) => {
                  const Icon = g.icon;
                  const verdict = classifyScore(g.value);
                  return (
                    <div
                      key={g.key}
                      style={{ animationDelay: `${index * 80}ms` }}
                      className="card-glass p-4 animate-fade-in-up"
                    >
                      <div className="flex items-center gap-2 text-zinc-300">
                        <Icon className="w-4 h-4 text-amber-300" />
                        <span className="text-xs font-medium uppercase tracking-wide">
                          {g.label}
                        </span>
                      </div>
                      <div
                        className={`mt-2 text-3xl font-bold tabular-nums ${verdict.textClass}`}
                      >
                        {g.value}
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
                        {g.blurb}
                      </p>
                      {g.flag !== "ok" && (
                        <p className="mt-1 text-[10px] text-amber-300/80">
                          Flag: {g.flag}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* AI answer-content score (relevance / structure / depth /
                  communication). Runs in parallel with gesture analysis. */}
              <div className="max-w-3xl mx-auto text-left">
                {contentResult === null ? (
                  <div className="card-glass p-4 flex items-center gap-2 text-sm text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                    Scoring what you said…
                  </div>
                ) : !contentResult.available ? (
                  <div className="card-glass p-4 text-sm text-zinc-400">
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span className="text-xs font-medium uppercase tracking-wide">
                        AI content score
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] text-zinc-400 leading-snug">
                      {contentResult.feedback ||
                        contentResult.error ||
                        "Content scoring is unavailable right now."}
                    </p>
                  </div>
                ) : (
                  <div className="card-glass p-5 space-y-4 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-300">
                        <Sparkles className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-widest">
                          AI content score
                        </span>
                      </div>
                      <div
                        className={`text-2xl font-bold tabular-nums ${classifyScore(contentResult.total).textClass}`}
                      >
                        {contentResult.total}
                        <span className="text-sm text-zinc-500">/100</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Relevance", value: contentResult.relevance },
                        { label: "Structure", value: contentResult.structure },
                        { label: "Depth", value: contentResult.depth },
                        { label: "Communication", value: contentResult.communication },
                      ].map((item) => (
                        <div key={item.label} className="bg-zinc-800/50 rounded-lg p-3 text-center">
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                            {item.label}
                          </div>
                          <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">
                            {item.value}
                            <span className="text-[11px] text-zinc-500">/25</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {contentResult.feedback && (
                      <p className="text-[13px] text-zinc-300 leading-relaxed">
                        {contentResult.feedback}
                      </p>
                    )}
                    {contentResult.strengths && (
                      <p className="text-[12px] text-emerald-300/90 leading-relaxed">
                        <span className="font-semibold">Strengths: </span>
                        {contentResult.strengths}
                      </p>
                    )}
                    {contentResult.improvements && (
                      <p className="text-[12px] text-amber-300/90 leading-relaxed">
                        <span className="font-semibold">Improve: </span>
                        {contentResult.improvements}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {submitError && (
                <div className="mx-auto max-w-md card-glass border-rose-500/40 px-4 py-3 text-sm text-rose-300 text-left">
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  void submitForReview();
                }}
                className="btn-primary inline-flex items-center gap-2 px-5 py-2.5"
              >
                <Send className="w-4 h-4" />
                Submit for teacher review
              </button>
            </div>
          )}
        </section>
      )}

      {stage === "submitted" && (
        <section className="card-glass p-8 md:p-12 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-fuchsia-500 shadow-glow-sm mx-auto">
            <UserCheck className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-zinc-100">
            Awaiting teacher review
          </h2>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Your submission is in the queue. When a teacher scores it in the
            admin panel, this screen updates automatically with your combined
            score.
          </p>
          {submissionIdRef.current && (
            <p className="text-[11px] uppercase tracking-widest text-zinc-600">
              Submission&nbsp;
              <span className="text-zinc-400 font-mono">
                {submissionIdRef.current.slice(0, 8)}
              </span>
            </p>
          )}
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Checking every 5s{" "}
            <span className="text-zinc-600 normal-case tracking-normal">
              ({pollAttempts} attempts)
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                if (submissionIdRef.current) {
                  setPollAttempts((n) => n + 1);
                  void applyReviewIfPresent(submissionIdRef.current);
                }
              }}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Check now
            </button>
            <button
              type="button"
              onClick={() => {
                stopReviewPolling();
                onBack();
              }}
              className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-sm"
            >
              Come back later
            </button>
          </div>
          <p className="text-[11px] text-zinc-600 max-w-md mx-auto">
            The AI gesture score is already saved. The final combined score
            appears once a teacher posts their rubric.
          </p>
        </section>
      )}

      {stage === "complete" && (
        <section className="space-y-6">
          <header className="card-glass relative overflow-hidden p-6 md:p-10">
            <div
              aria-hidden
              className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-gradient-to-br from-amber-500/30 via-rose-500/15 to-transparent blur-3xl"
            />
            <div
              aria-hidden
              className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-gradient-to-tr from-brand-500/20 to-transparent blur-3xl"
            />
            <div className="relative grid md:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <div
                  className={`inline-flex items-center gap-2 text-xs uppercase tracking-widest border px-3 py-1 rounded-full ${finalVerdict.badgeClass}`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>Combined score · {finalVerdict.label}</span>
                </div>
                <div className="mt-5 flex items-end gap-3">
                  <div
                    className={`text-7xl md:text-8xl font-bold tabular-nums leading-none ${finalVerdict.textClass}`}
                    style={
                      {
                        textShadow:
                          finalScore >= 70
                            ? "0 0 32px rgba(99,102,241,0.4)"
                            : undefined,
                      } as CSSProperties
                    }
                  >
                    {finalScore}
                  </div>
                  <div className="pb-3 text-zinc-500 text-sm">/ 100</div>
                </div>
                <p className="mt-3 text-zinc-400 text-sm max-w-md leading-relaxed">
                  Weighted 50% AI body-language analysis · 50% teacher rubric.
                  Adjust weights in settings once that panel ships.
                </p>
              </div>
              <div className="flex flex-col gap-2 min-w-[200px]">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="btn-primary inline-flex items-center gap-2 justify-center px-5 py-2.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try another
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="btn-ghost inline-flex items-center gap-2 justify-center px-5 py-2.5"
                >
                  Home
                </button>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="card-glass p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-amber-300 mb-3">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI body language · {gestureAverage}/100</span>
              </div>
              <div className="space-y-3">
                {gestureScores.map((g) => {
                  const verdict = classifyScore(g.value);
                  const Icon = g.icon;
                  return (
                    <div key={g.key} className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-amber-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-200">{g.label}</span>
                          <span
                            className={`font-semibold tabular-nums ${verdict.textClass}`}
                          >
                            {g.value}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-zinc-900/80 border border-zinc-800/70 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"
                            style={{ width: `${g.value}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card-glass p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-brand-300 mb-3">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Teacher rubric · {teacherAverage}/100</span>
              </div>
              {teacherComment && (
                <div className="mb-4 rounded-xl bg-brand-500/5 border border-brand-500/20 px-3 py-2.5 text-sm text-zinc-300 leading-relaxed">
                  <div className="text-[10px] uppercase tracking-widest text-brand-300 mb-1">
                    Teacher note
                  </div>
                  {teacherComment}
                </div>
              )}
              <div className="space-y-3">
                {teacherRubric.map((item) => (
                  <div
                    key={item.key}
                    className="border-l-2 border-brand-500/60 pl-3 py-1"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-200">{item.label}</span>
                      <span className="text-zinc-100 font-semibold tabular-nums">
                        {item.score}/{item.out_of}
                      </span>
                    </div>
                    {item.comment && (
                      <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                        {item.comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-glass border-emerald-500/40 px-4 py-3 flex items-start gap-3 text-sm text-emerald-200">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-300" />
            <span>
              Real scores: the AI body-language analysis comes from the
              MediaPipe pipeline and the rubric was posted by a teacher via
              the admin panel.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface StepperProps {
  stage: Stage;
}

function Stepper({ stage }: StepperProps) {
  const steps: Array<{ key: Stage; label: string }> = [
    { key: "pick", label: "Pick" },
    { key: "record", label: "Record" },
    { key: "analyze", label: "AI Analysis" },
    { key: "submitted", label: "Teacher Review" },
    { key: "complete", label: "Combined Score" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === stage);
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-widest">
      {steps.map((step, idx) => {
        const isActive = idx === activeIdx;
        const isDone = idx < activeIdx;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={[
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border",
                isActive
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                  : isDone
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-zinc-900/60 border-zinc-800/70 text-zinc-500",
              ].join(" ")}
            >
              {isDone && <CheckCircle2 className="w-3 h-3" />}
              {step.label}
            </span>
            {idx < steps.length - 1 && (
              <span
                aria-hidden
                className={
                  isDone
                    ? "h-px w-4 bg-emerald-500/40"
                    : "h-px w-4 bg-zinc-800"
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
