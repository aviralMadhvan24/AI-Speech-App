import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Hand,
  Info,
  Loader2,
  Lock,
  PersonStanding,
  Send,
  Smile,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import {
  fetchSubmissionDetail,
  fetchSubmissionVideoBlob,
  submitReview,
  type AdminGestureMetric,
  type AdminSubmissionDetail,
} from "../../adminApi";
import { formatDateTime, relativeTime } from "../../utils/time";
import { scoreColorClasses } from "../../utils/scoreColor";

interface AdminReviewViewProps {
  submissionId: string;
  onBack: () => void;
  onReviewed: (submissionId: string) => void;
}

interface RubricState {
  structure: number;
  clarity: number;
  evidence: number;
  presence: number;
}

const RUBRIC_LABELS: Array<{
  key: keyof RubricState;
  label: string;
  hint: string;
}> = [
  {
    key: "structure",
    label: "Structure",
    hint: "STAR / opening / closing — does the answer flow?",
  },
  {
    key: "clarity",
    label: "Clarity",
    hint: "Diction, pace, filler words. Are ideas easy to follow?",
  },
  {
    key: "evidence",
    label: "Evidence",
    hint: "Concrete examples, metrics, specifics — not just buzzwords.",
  },
  {
    key: "presence",
    label: "Presence",
    hint: "Confidence, energy, tone. Connects with the camera?",
  },
];

const METRIC_META: Record<
  string,
  { label: string; icon: typeof Eye }
> = {
  posture: { label: "Posture", icon: PersonStanding },
  eye_contact: { label: "Eye Contact", icon: Eye },
  gesture: { label: "Hand Gestures", icon: Hand },
  stillness: { label: "Stillness", icon: Sparkles },
  facial_expression: { label: "Facial Expression", icon: Smile },
};

function metricMeta(name: string) {
  return (
    METRIC_META[name] ?? {
      label: name.replace(/_/g, " "),
      icon: Sparkles,
    }
  );
}

function avgRubric(r: RubricState): number {
  return (r.structure + r.clarity + r.evidence + r.presence) / 4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function AdminReviewView({
  submissionId,
  onBack,
  onReviewed,
}: AdminReviewViewProps) {
  const [detail, setDetail] = useState<AdminSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const [rubric, setRubric] = useState<RubricState>({
    structure: 7,
    clarity: 7,
    evidence: 7,
    presence: 7,
  });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // ---- Load submission detail ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSubmissionDetail(submissionId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        if (data.review) {
          setRubric({
            structure: data.review.rubric.structure,
            clarity: data.review.rubric.clarity,
            evidence: data.review.rubric.evidence,
            presence: data.review.rubric.presence,
          });
          setComment(data.review.comment ?? "");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not load submission.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // ---- Lazy load the video as an authenticated blob URL ----
  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);
    setVideoError(null);
    setVideoLoading(true);
    fetchSubmissionVideoBlob(submissionId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrlRef.current = url;
        setVideoUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Video unavailable.";
        setVideoError(message);
      })
      .finally(() => {
        if (!cancelled) setVideoLoading(false);
      });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [submissionId]);

  const teacherScore = useMemo(() => {
    return Math.round(avgRubric(rubric) * 10);
  }, [rubric]);

  const combinedScore = useMemo(() => {
    const gesture = detail?.submission.gesture_score ?? 0;
    return Math.round(gesture * 0.5 + teacherScore * 0.5);
  }, [detail, teacherScore]);

  const readOnly = !!detail?.review;

  const handleSubmit = useCallback(async () => {
    if (readOnly) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitReview(submissionId, {
        structure: rubric.structure,
        clarity: rubric.clarity,
        evidence: rubric.evidence,
        presence: rubric.presence,
        comment: comment.trim().slice(0, 1000),
      });
      setToast("Review saved. Heading back to pending list…");
      window.setTimeout(() => {
        onReviewed(submissionId);
      }, 700);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submitting the review failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [readOnly, submissionId, rubric, comment, onReviewed]);

  // ---- Render ----

  return (
    <div key="admin-review" className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Back to pending list"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to pending
        </button>
        {readOnly && (
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
            <Lock className="w-3 h-3" />
            Already reviewed
          </span>
        )}
      </div>

      {loading && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading submission…
        </div>
      )}

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{error}</div>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 text-xs font-medium text-rose-200 underline underline-offset-4"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {detail && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
          {/* Left column — video + context */}
          <div className="space-y-4">
            <div className="card-glass relative overflow-hidden p-3">
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/70 relative">
                {videoLoading && !videoError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                    <div className="inline-flex items-center gap-2 text-sm text-zinc-400">
                      <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
                      Loading video…
                    </div>
                  </div>
                )}
                {videoError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 p-4 text-center">
                    <div>
                      <Video className="w-7 h-7 text-zinc-600 mx-auto" />
                      <p className="mt-2 text-sm text-zinc-400">
                        Video unavailable for older submissions.
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-600">
                        {videoError}
                      </p>
                    </div>
                  </div>
                )}
                {videoUrl && !videoError && (
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
            </div>

            <div className="card-glass p-5">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
                Student
              </div>
              <div className="text-lg font-semibold text-zinc-100">
                {detail.submission.student_name ||
                  detail.submission.student_email}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {detail.submission.student_email}
              </div>
              <div className="mt-3 text-[11px] text-zinc-500 inline-flex items-center gap-2">
                <span className="uppercase tracking-widest">Submitted</span>
                <span>
                  {relativeTime(detail.submission.submitted_at)} ·{" "}
                  {formatDateTime(detail.submission.submitted_at)}
                </span>
              </div>
            </div>

            <div className="card-glass p-5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
                <span>Question</span>
                {detail.submission.question_category && (
                  <span className="text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                    {detail.submission.question_category}
                  </span>
                )}
              </div>
              <p className="text-base text-zinc-100 leading-snug">
                {detail.submission.question_prompt}
              </p>
              <p className="mt-2 text-[11px] text-zinc-500 tabular-nums">
                Duration: {Math.round(detail.submission.duration_seconds)}s
              </p>
            </div>
          </div>

          {/* Right column — AI summary + rubric form */}
          <div className="space-y-4">
            <AIBodyLanguageCard
              average={detail.submission.gesture_score}
              metrics={detail.submission.gesture_metrics}
            />

            <div className="card-glass p-5">
              <div className="text-[10px] uppercase tracking-widest text-sky-300 mb-2">
                Pronunciation analysis
              </div>
              {detail.submission.pronunciation_state === "pending" ? (
                <p className="text-sm text-amber-300">Processing in the background…</p>
              ) : detail.submission.content_result?.pronunciation.available ? (
                <>
                  <div className="text-2xl font-semibold text-sky-100">
                    {Math.round(detail.submission.content_result.pronunciation.score ?? 0)}/100
                  </div>
                  <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                    {detail.submission.content_result.pronunciation.feedback}
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  {detail.submission.content_result?.pronunciation.feedback || "Not available."}
                </p>
              )}
            </div>

            <div className="card-glass p-5 space-y-5">
              <div>
                <h3 className="text-base font-semibold text-zinc-100 inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-brand-300" />
                  Rubric · {readOnly ? "Read-only" : "0–10 per dimension"}
                </h3>
                {readOnly && detail.review && (
                  <p className="text-[11px] text-emerald-300 mt-1">
                    Reviewed {relativeTime(detail.review.reviewed_at)} by{" "}
                    {detail.review.reviewer_name ||
                      detail.review.reviewer_email}
                  </p>
                )}
              </div>

              <div className="space-y-4">
                {RUBRIC_LABELS.map(({ key, label, hint }) => (
                  <RubricSlider
                    key={key}
                    label={label}
                    hint={hint}
                    value={rubric[key]}
                    disabled={readOnly}
                    onChange={(value) =>
                      setRubric((prev) => ({
                        ...prev,
                        [key]: clamp(value, 0, 10),
                      }))
                    }
                  />
                ))}
              </div>

              <div>
                <label
                  htmlFor="review-comment"
                  className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold"
                >
                  Comment
                </label>
                <textarea
                  id="review-comment"
                  value={comment}
                  disabled={readOnly}
                  onChange={(event) =>
                    setComment(event.target.value.slice(0, 1000))
                  }
                  rows={3}
                  placeholder="What worked? What's the one thing to try next time?"
                  className="mt-1 w-full rounded-xl bg-zinc-900/60 border border-zinc-800 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/40 focus:outline-none px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none disabled:opacity-70"
                />
                <div className="mt-1 flex justify-end text-[11px] text-zinc-500 tabular-nums">
                  {comment.length}/1000
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800/70">
                <PreviewBlock
                  label="Teacher score"
                  value={teacherScore}
                  hint="Average × 10"
                />
                <PreviewBlock
                  label="Combined"
                  value={combinedScore}
                  hint="50% AI · 50% teacher"
                  highlighted
                />
              </div>

              {submitError && (
                <div className="card-glass border-rose-500/40 px-3 py-2 text-xs text-rose-300 inline-flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {submitError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={readOnly || submitting}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Submit review
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 card-glass border-emerald-500/40 px-4 py-3 text-sm text-emerald-200 inline-flex items-center gap-2 animate-fade-in-up">
          <CheckCircle2 className="w-4 h-4" />
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: small subcomponents kept private to this view
// ---------------------------------------------------------------------------

interface RubricSliderProps {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function RubricSlider({
  label,
  hint,
  value,
  disabled,
  onChange,
}: RubricSliderProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={`rubric-${label.toLowerCase()}`}
          className="text-sm font-medium text-zinc-200"
        >
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums text-brand-300">
          {value}
          <span className="text-zinc-500">/10</span>
        </span>
      </div>
      <input
        id={`rubric-${label.toLowerCase()}`}
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-brand-500 disabled:opacity-60"
      />
      <p className="text-[11px] text-zinc-500 mt-1 leading-snug">{hint}</p>
    </div>
  );
}

interface PreviewBlockProps {
  label: string;
  value: number;
  hint: string;
  highlighted?: boolean;
}

function PreviewBlock({ label, value, hint, highlighted }: PreviewBlockProps) {
  const verdict = scoreColorClasses(value);
  return (
    <div
      className={[
        "rounded-xl px-4 py-3 border",
        highlighted
          ? `${verdict.bg} ${verdict.border}`
          : "bg-zinc-900/40 border-zinc-800/70",
      ].join(" ")}
    >
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
        {label}
      </div>
      <div
        className={`text-3xl font-bold tabular-nums leading-none mt-1 ${
          highlighted ? verdict.text : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>
    </div>
  );
}

interface AIBodyLanguageCardProps {
  average: number;
  metrics: AdminGestureMetric[];
}

function AIBodyLanguageCard({ average, metrics }: AIBodyLanguageCardProps) {
  const verdict = scoreColorClasses(average);
  return (
    <div className="card-glass p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-300">
          <Sparkles className="w-3.5 h-3.5" />
          AI body language
        </div>
        <div
          className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums border px-2.5 py-1 rounded-full ${verdict.bg} ${verdict.text} ${verdict.border}`}
        >
          {Math.round(average)}/100
        </div>
      </div>

      {metrics.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No per-metric breakdown reported.
        </p>
      ) : (
        <div className="space-y-2.5">
          {metrics.map((m) => {
            const meta = metricMeta(m.name);
            const Icon = meta.icon;
            const value = typeof m.score === "number" ? m.score : 0;
            const inner = scoreColorClasses(value);
            return (
              <div key={m.name} className="flex items-center gap-3">
                <Icon className="w-4 h-4 text-amber-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-200 truncate">{meta.label}</span>
                    <span
                      className={`font-semibold tabular-nums ${inner.text}`}
                    >
                      {Math.round(value)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-zinc-900/80 border border-zinc-800/70 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </div>
                  {m.flag && m.flag !== "ok" && (
                    <p className="text-[10px] text-amber-300/80 mt-0.5">
                      Flag: {m.flag}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
