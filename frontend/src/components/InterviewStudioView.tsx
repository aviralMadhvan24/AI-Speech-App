import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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

function rand(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function pickGestureScores(): GestureScore[] {
  return [
    {
      key: "eye",
      label: "Eye Contact",
      value: rand(60, 90),
      icon: Eye,
      blurb: "Tracked face landmarks across the recording. Steady gaze on camera looks confident.",
    },
    {
      key: "posture",
      label: "Posture",
      value: rand(65, 92),
      icon: PersonStanding,
      blurb: "Upright shoulders and head alignment. Avoid slouching forward.",
    },
    {
      key: "gestures",
      label: "Hand Gestures",
      value: rand(55, 88),
      icon: Hand,
      blurb: "Natural, open hand motion adds energy without becoming distracting.",
    },
    {
      key: "expression",
      label: "Facial Expression",
      value: rand(60, 90),
      icon: Smile,
      blurb: "Micro-expressions stay engaged. Smile when introducing a story.",
    },
  ];
}

function pickTeacherRubric(): TeacherRubricItem[] {
  return [
    {
      key: "structure",
      label: "Structure & STAR",
      score: rand(6, 9),
      out_of: 10,
      comment: "Clear opening claim. The result step was light — quantify your impact next time.",
    },
    {
      key: "clarity",
      label: "Clarity of Thought",
      score: rand(6, 9),
      out_of: 10,
      comment: "Ideas flow well, minimal filler. Avoid back-tracking mid-sentence.",
    },
    {
      key: "evidence",
      label: "Evidence & Specifics",
      score: rand(5, 9),
      out_of: 10,
      comment: "Add one concrete example with a metric — that lands much harder.",
    },
    {
      key: "presence",
      label: "Presence",
      score: rand(6, 9),
      out_of: 10,
      comment: "Confident tone. Slow down slightly when delivering the resolution.",
    },
  ];
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
  const [stage, setStage] = useState<Stage>("pick");
  const [questionIdx, setQuestionIdx] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedTimerRef = useRef<number | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [gestureScores, setGestureScores] = useState<GestureScore[]>([]);
  const [teacherRubric, setTeacherRubric] = useState<TeacherRubricItem[]>([]);

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

  const startRecording = useCallback(() => {
    setIsRecording(true);
    setElapsed(0);
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
    }
    const startedAt = Date.now();
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const beginAnalysis = useCallback(() => {
    stopRecording();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setAnalyzeProgress(0);
    setStage("analyze");

    // Simulate the gesture analysis pipeline with a brief progress bar.
    const startedAt = Date.now();
    const total = 2400; // ms
    const tick = () => {
      const pct = Math.min(100, Math.round(((Date.now() - startedAt) / total) * 100));
      setAnalyzeProgress(pct);
      if (pct < 100) {
        window.setTimeout(tick, 80);
      } else {
        setGestureScores(pickGestureScores());
      }
    };
    tick();
  }, [stream, stopRecording]);

  const submitForReview = useCallback(() => {
    setStage("submitted");
    // After a short delay, "teacher" reviews and posts scores.
    window.setTimeout(() => {
      setTeacherRubric(pickTeacherRubric());
      setStage("complete");
    }, 2200);
  }, []);

  const handleRestart = useCallback(() => {
    setStage("pick");
    setQuestionIdx(0);
    setIsRecording(false);
    setElapsed(0);
    setGestureScores([]);
    setTeacherRubric([]);
    setAnalyzeProgress(0);
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, [stream]);

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
          <Loader2 className="w-10 h-10 text-amber-300 animate-spin mx-auto" />
          <div>
            <h2 className="text-2xl font-semibold text-zinc-100">
              Analysing your body language
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Posture · eye contact · gestures · expression
            </p>
          </div>
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
          {analyzeProgress === 100 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-100">
                Body language summary
              </h3>
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
                      <div className={`mt-2 text-3xl font-bold tabular-nums ${verdict.textClass}`}>
                        {g.value}
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
                        {g.blurb}
                      </p>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={submitForReview}
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
        <section className="card-glass p-8 md:p-12 text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-fuchsia-500 shadow-glow-sm mx-auto">
            <UserCheck className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-zinc-100">
            Awaiting teacher review
          </h2>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Your answer is in the queue. Teachers usually post a rubric score
            within a day. The preview demo simulates a near-instant response.
          </p>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scoring…
          </div>
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
                    <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                      {item.comment}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-glass border-amber-500/40 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
            <span>
              Preview mode: AI scores and teacher feedback are simulated. Once
              the gesture analysis backend and the teacher review pipeline land,
              this same screen renders the real combined score.
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
