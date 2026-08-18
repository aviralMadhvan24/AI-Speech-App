import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Briefcase, Clock3, Loader2, Trophy, Users2 } from "lucide-react";
import {
  getDebateDetail,
  type DebateDetailResponse,
  type FinalStanding,
  type ScoreBreakdown,
} from "../debateApi";
import {
  getGDSessionDetail,
  type GDParticipantScore,
  type GDResultsResponse,
} from "../gdApi";
import {
  fetchMySubmission,
  type StudentSubmissionDetail,
} from "../api";
import { DebateTurnsAudio } from "./DebateTurnsAudio";

type PerformanceResultKind = "debate" | "gd" | "interview";

interface PerformanceResultViewProps {
  kind: PerformanceResultKind;
  id: string;
  onBack: () => void;
}

function scoreTone(score: number): string {
  if (score >= 70) return "text-emerald-300";
  if (score >= 50) return "text-zinc-100";
  if (score >= 30) return "text-amber-300";
  return "text-rose-300";
}

function pendingResultCard(label: string) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
      <Clock3 className="mx-auto h-9 w-9 text-amber-300" />
      <h2 className="mt-3 text-xl font-semibold text-zinc-100">Result is being prepared</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
        Detailed {label} analysis is still running. The final result, ranking, and winner
        will appear here after it finishes. Please check My Performance again in a few minutes.
      </p>
    </div>
  );
}

function DebateResult({ result }: { result: DebateDetailResponse }) {
  const pending =
    result.scoring_mode === "detailed" &&
    result.final_standings.some((standing) => !standing.full_score_ready);
  const scoredStandings = [...result.final_standings]
    .map((standing) => ({
      standing,
      score:
        result.scoring_mode === "detailed" && standing.full_ai_score != null
          ? standing.full_ai_score
          : standing.effective_score,
    }))
    .sort((a, b) => b.score - a.score);
  const topScore = scoredStandings[0]?.score;
  const winner =
    topScore != null &&
    scoredStandings.filter((item) => Math.round(item.score * 10) === Math.round(topScore * 10)).length === 1
      ? scoredStandings[0]
      : null;

  const playableTurns = result.turn_audio.filter((turn) => turn.audio_url);

  if (pending) return pendingResultCard("debate");

  return (
    <div className="space-y-4">
      {winner ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-300">Winner</div>
          <div className="mt-1 text-2xl font-bold text-amber-200">{winner.standing.display_name}</div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-5 text-center text-sm text-zinc-300">
          This debate ended in a draw.
        </div>
      )}
      <div className="space-y-2">
        {scoredStandings.map(({ standing, score }, index) => {
          return <DebateStanding key={standing.participant_id} standing={standing} score={score} rank={index + 1} isWinner={winner?.standing.participant_id === standing.participant_id} />;
        })}
      </div>
      {playableTurns.length > 0 ? (
        <DebateTurnsAudio turns={result.turn_audio} title="Turn Playback" />
      ) : (
        <p className="rounded-xl border border-zinc-700/70 bg-zinc-800/40 p-4 text-xs text-zinc-500">
          No turn audio was saved for this debate.
        </p>
      )}
    </div>
  );
}

function componentTone(value: number | null | undefined, max: number): string {
  if (value == null) return "text-zinc-500";
  const pct = (value / max) * 100;
  if (pct >= 70) return "text-emerald-300";
  if (pct >= 40) return "text-zinc-100";
  return "text-amber-300";
}

/** Per-component breakdown: pronunciation /25, fluency /25, content /50. */
function ScoreBreakdownPanel({
  breakdown,
  contentScore,
}: {
  breakdown: ScoreBreakdown | null;
  contentScore: number | null;
}) {
  if (!breakdown) return null;

  const pronunciation = breakdown.pronunciation?.weighted ?? null;
  const fluency = breakdown.fluency?.weighted ?? null;
  const content = breakdown.content?.total ?? contentScore ?? null;
  const details = breakdown.content?.details ?? null;

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-700/60 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Score breakdown
      </div>
      <ComponentGrid
        items={[
          {
            label: "Pronunciation",
            value: pronunciation,
            max: 25,
            note:
              breakdown.pronunciation?.raw != null
                ? `raw ${Math.round(breakdown.pronunciation.raw)}/100`
                : undefined,
          },
          {
            label: "Fluency",
            value: fluency,
            max: 25,
            note:
              breakdown.fluency?.raw != null
                ? `clarity ${Math.round(breakdown.fluency.raw)}/100`
                : undefined,
          },
          { label: "Content", value: content, max: 50 },
        ]}
      />

      {details && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-zinc-800/40 p-2 text-[11px] text-zinc-400 sm:grid-cols-4">
          {[
            { label: "Relevance", value: details.relevance, max: 15 },
            { label: "Arguments", value: details.arguments, max: 15 },
            { label: "Structure", value: details.structure, max: 10 },
            { label: "Vocabulary", value: details.vocabulary, max: 10 },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-2">
              <span>{item.label}</span>
              <span className="tabular-nums text-zinc-200">
                {item.value != null ? item.value : "—"}/{item.max}
              </span>
            </div>
          ))}
        </div>
      )}

      {breakdown.content_missing && (
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          Content could not be assessed, so delivery was scored out of 50.
        </p>
      )}
      {details?.off_topic && (
        <p className="text-[11px] leading-relaxed text-rose-300/80">
          Flagged as off-topic: the speech did not address the motion.
        </p>
      )}
    </div>
  );
}

/** Reusable row of weighted score components, each shown out of its own max. */
function ComponentGrid({
  items,
  columns = 3,
}: {
  items: { label: string; value: number | null; max: number; note?: string }[];
  columns?: 3 | 5;
}) {
  return (
    <div
      className={`grid gap-2 ${columns === 5 ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-3"}`}
    >
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-zinc-800/60 p-2">
          <div className="text-[11px] text-zinc-400">{item.label}</div>
          <div
            className={`text-sm font-semibold tabular-nums ${componentTone(item.value, item.max)}`}
          >
            {item.value != null ? item.value.toFixed(1) : "Not scored"}
            <span className="text-[11px] font-normal text-zinc-500">/{item.max}</span>
          </div>
          {item.note && <div className="text-[10px] text-zinc-500">{item.note}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * GD rubric breakdown: content 30, communication 20, participation 20,
 * listening 15, leadership 15 (see `app/gd/scoring.py`).
 */
function GDScoreBreakdownPanel({ score }: { score: GDParticipantScore }) {
  return (
    <div className="mt-3 space-y-2 border-t border-zinc-700/60 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Score breakdown
      </div>
      <ComponentGrid
        columns={5}
        items={[
          { label: "Content", value: score.content_quality, max: 30 },
          {
            label: "Communication",
            value: score.communication,
            max: 20,
            note: "pronunciation + fluency",
          },
          {
            label: "Participation",
            value: score.participation,
            max: 20,
            note: "speak time + turns",
          },
          { label: "Listening", value: score.listening, max: 15 },
          { label: "Leadership", value: score.leadership, max: 15 },
        ]}
      />
      {(score.interruption_count > 0 || score.was_interrupted_count > 0) && (
        <p className="text-[11px] text-zinc-500">
          Interrupted others {score.interruption_count}× · was interrupted{" "}
          {score.was_interrupted_count}×
        </p>
      )}
      {score.speech_count === 0 && (
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          Did not speak, so no rubric points could be awarded.
        </p>
      )}
    </div>
  );
}

function DebateStanding({ standing, score, rank, isWinner }: { standing: FinalStanding; score: number; rank: number; isWinner: boolean }) {
  return (
    <article className={[
      "rounded-xl border bg-zinc-800/50 p-4",
      isWinner ? "border-amber-500/40" : "border-zinc-700/70",
    ].join(" ")}>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold text-zinc-200">#{rank}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">{standing.display_name}</div>
          <div className="text-xs text-zinc-500">
            {standing.content_score != null ? `Content ${Math.round(standing.content_score)}/50` : "Overall score"}
            {standing.is_forfeit ? " · Forfeit" : ""}
          </div>
        </div>
        <div className={`text-xl font-bold tabular-nums ${scoreTone(score)}`}>{Math.round(score)}<span className="text-sm font-normal text-zinc-500">/100</span></div>
        {isWinner && <Trophy className="h-4 w-4 text-amber-300" aria-label="Winner" />}
      </div>
      {standing.content_feedback && <p className="mt-3 border-l-2 border-violet-500/40 pl-3 text-xs leading-relaxed text-zinc-400">{standing.content_feedback}</p>}
      <ScoreBreakdownPanel breakdown={standing.score_breakdown} contentScore={standing.content_score} />
    </article>
  );
}

function GDResult({ result }: { result: GDResultsResponse }) {
  const pending =
    result.scoring_mode === "detailed" && result.scores.some((score) => !score.full_score_ready);
  const orderedScores = useMemo(() => [...result.scores]
    .map((score) => ({
      score,
      finalScore: result.scoring_mode === "detailed" && score.full_total_score != null
        ? score.full_total_score
        : score.total_score,
    }))
    .sort((a, b) => b.finalScore - a.finalScore), [result]);
  const topScore = orderedScores[0]?.finalScore;
  const winnerId = topScore != null && orderedScores.filter((item) => Math.round(item.finalScore * 10) === Math.round(topScore * 10)).length === 1
    ? orderedScores[0].score.participant_id
    : null;

  if (pending) return pendingResultCard("group-discussion");

  return (
    <div className="space-y-2">
      {orderedScores.map(({ score, finalScore }, index) => {
        const isWinner = winnerId === score.participant_id;
        return (
          <article key={score.participant_id} className={[
            "rounded-xl border bg-zinc-800/50 p-4",
            isWinner ? "border-amber-500/40" : "border-zinc-700/70",
          ].join(" ")}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold text-zinc-200">#{index + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-100">{score.display_name}</div>
                <div className="text-xs text-zinc-500">{score.speech_count} speeches · {Math.floor(score.total_speak_seconds)}s spoken</div>
              </div>
              <div className={`text-xl font-bold tabular-nums ${scoreTone(finalScore)}`}>{finalScore.toFixed(1)}<span className="text-sm font-normal text-zinc-500">/100</span></div>
              {isWinner && <Trophy className="h-4 w-4 text-amber-300" aria-label="Winner" />}
            </div>
            {score.feedback && <p className="mt-3 border-l-2 border-emerald-500/40 pl-3 text-xs leading-relaxed text-zinc-400">{score.feedback}</p>}
            <GDScoreBreakdownPanel score={score} />
          </article>
        );
      })}
    </div>
  );
}

/**
 * Interview rubric breakdown: content is scored 0-100 as four equal /25
 * components (see `app/interview/content_scoring.py`), while gesture and
 * pronunciation are independent 0-100 scales.
 */
function InterviewResult({ result }: { result: StudentSubmissionDetail }) {
  const content = result.contentResult;
  const pronunciation = content?.pronunciation ?? null;
  const pronunciationPending = result.pronunciationState === "pending";
  const contentScored = content != null && content.available;

  // The headline mirrors what the profile list shows: the teacher's combined
  // score once reviewed, otherwise the automated gesture score.
  const headline = result.combinedScore ?? result.gestureScore;
  const headlineLabel =
    result.combinedScore != null ? "Combined score" : "Gesture score";

  return (
    <div className="space-y-4">
      {/* Overall */}
      <div className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-5 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          {headlineLabel}
        </div>
        <div className={`mt-1 text-4xl font-bold tabular-nums ${scoreTone(headline)}`}>
          {Math.round(headline)}
          <span className="text-lg font-normal text-zinc-500">/100</span>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {result.status === "reviewed"
            ? "Reviewed by your teacher"
            : "Awaiting teacher review"}
          {result.durationSeconds > 0 &&
            ` · ${Math.round(result.durationSeconds)}s answer`}
        </div>
      </div>

      {/* Top-level components, same shape as the debate/GD breakdown */}
      <article className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Score breakdown
        </div>
        <div className="mt-2">
          <ComponentGrid
            items={[
              {
                label: "Content",
                value: contentScored ? content!.total : null,
                max: 100,
                note: "AI answer analysis",
              },
              {
                label: "Gesture",
                value: result.gestureScore,
                max: 100,
                note: "body language",
              },
              {
                label: "Pronunciation",
                value: pronunciation?.available ? pronunciation.score : null,
                max: 100,
                note: pronunciationPending ? "processing…" : "clarity of speech",
              },
            ]}
          />
        </div>

        {/* Content sub-rubric — four equal quarters of the content score. */}
        {contentScored && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-zinc-800/40 p-2 text-[11px] text-zinc-400 sm:grid-cols-4">
            {[
              { label: "Relevance", value: content!.relevance },
              { label: "Structure", value: content!.structure },
              { label: "Depth", value: content!.depth },
              { label: "Communication", value: content!.communication },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2">
                <span>{item.label}</span>
                <span className="tabular-nums text-zinc-200">{item.value}/25</span>
              </div>
            ))}
          </div>
        )}

        {!contentScored && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
            {content?.error === "transcript_too_short"
              ? "The answer was too short for content feedback — aim for at least 30 seconds."
              : content?.feedback ||
                "Content could not be assessed for this answer."}
          </p>
        )}
      </article>

      {/* Pronunciation detail — mirrors the delayed-scoring states. */}
      <article className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Pronunciation
        </div>
        {pronunciationPending ? (
          <p className="mt-2 inline-flex items-center gap-2 text-xs text-amber-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Still analysing your speech — this page refreshes automatically.
          </p>
        ) : pronunciation?.available ? (
          <>
            <div
              className={`mt-1 text-2xl font-bold tabular-nums ${scoreTone(
                pronunciation.score ?? 0,
              )}`}
            >
              {Math.round(pronunciation.score ?? 0)}
              <span className="text-sm font-normal text-zinc-500">/100</span>
            </div>
            <p className="mt-2 border-l-2 border-brand-500/40 pl-3 text-xs leading-relaxed text-zinc-400">
              {pronunciation.feedback}
            </p>
            {pronunciation.issueCount > 0 && (
              <p className="mt-2 text-[11px] text-zinc-500">
                {pronunciation.issueCount} sound
                {pronunciation.issueCount === 1 ? "" : "s"} flagged as unclear.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {pronunciation?.feedback || "Pronunciation was not scored for this answer."}
          </p>
        )}
      </article>

      {/* AI written feedback */}
      {contentScored && (content!.feedback || content!.strengths || content!.improvements) && (
        <article className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Answer feedback
          </div>
          {content!.feedback && (
            <p className="mt-2 border-l-2 border-violet-500/40 pl-3 text-xs leading-relaxed text-zinc-400">
              {content!.feedback}
            </p>
          )}
          {content!.strengths && (
            <p className="mt-3 text-xs leading-relaxed text-emerald-300/90">
              <span className="font-semibold">Strengths: </span>
              {content!.strengths}
            </p>
          )}
          {content!.improvements && (
            <p className="mt-2 text-xs leading-relaxed text-amber-300/90">
              <span className="font-semibold">Work on: </span>
              {content!.improvements}
            </p>
          )}
        </article>
      )}

      {/* Body language per-metric detail */}
      {result.gestureMetrics.length > 0 && (
        <article className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Body language
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {result.gestureMetrics.map((metric) => (
              <div key={metric.name} className="rounded-lg bg-zinc-800/60 p-2">
                <div className="truncate text-[11px] capitalize text-zinc-400">
                  {metric.name.replace(/_/g, " ")}
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${componentTone(
                    metric.score,
                    100,
                  )}`}
                >
                  {metric.score != null ? metric.score : "Not scored"}
                  {metric.score != null && (
                    <span className="text-[11px] font-normal text-zinc-500">/100</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Teacher review, once posted */}
      {result.review && (
        <article className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
            Teacher review
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-zinc-800/40 p-2 text-[11px] text-zinc-400 sm:grid-cols-4">
            {[
              { label: "Structure", value: result.review.rubric.structure },
              { label: "Clarity", value: result.review.rubric.clarity },
              { label: "Evidence", value: result.review.rubric.evidence },
              { label: "Presence", value: result.review.rubric.presence },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2">
                <span>{item.label}</span>
                <span className="tabular-nums text-zinc-200">{item.value}/25</span>
              </div>
            ))}
          </div>
          {result.review.comment && (
            <p className="mt-3 border-l-2 border-emerald-500/40 pl-3 text-xs leading-relaxed text-zinc-300">
              {result.review.comment}
            </p>
          )}
        </article>
      )}

      {/* Transcript last — it is the longest block. */}
      {content?.transcript && (
        <article className="rounded-xl border border-zinc-700/70 bg-zinc-800/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            What you said
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            {content.transcript}
          </p>
        </article>
      )}
    </div>
  );
}

type PerformanceResult =
  | DebateDetailResponse
  | GDResultsResponse
  | StudentSubmissionDetail;

export function PerformanceResultView({ kind, id, onBack }: PerformanceResultViewProps) {
  const [result, setResult] = useState<PerformanceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    setResult(null);
    setError(null);

    // A detailed debate finishes scoring in a background task, so the first
    // response is often still "being prepared". Interviews are the same for
    // their delayed pronunciation pass. Poll until it lands instead of making
    // the user reload the page.
    const isStillPending = (data: PerformanceResult): boolean => {
      if (kind === "interview") {
        return (data as StudentSubmissionDetail).pronunciationState === "pending";
      }
      if (kind !== "debate") return false;
      const debate = data as DebateDetailResponse;
      return (
        debate.scoring_mode === "detailed" &&
        debate.final_standings.some((standing) => !standing.full_score_ready)
      );
    };

    const fetchResult = () => {
      const load: Promise<PerformanceResult> =
        kind === "debate"
          ? getDebateDetail(id)
          : kind === "gd"
            ? getGDSessionDetail(id)
            : fetchMySubmission(id);
      void load
        .then((data) => {
          if (!active) return;
          setResult(data);
          if (!isStillPending(data) && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : "Could not load this result.");
        });
    };

    fetchResult();
    timer = setInterval(fetchResult, 15000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [kind, id]);

  const title =
    kind === "debate"
      ? "Debate Result"
      : kind === "gd"
        ? "Group Discussion Result"
        : "Interview Result";
  const subtitle = result
    ? kind === "debate"
      ? (result as DebateDetailResponse).motion.title
      : kind === "gd"
        ? (result as GDResultsResponse).topic.title
        : (result as StudentSubmissionDetail).questionPrompt
    : "Loading final result";
  const HeaderIcon = kind === "interview" ? Briefcase : Users2;

  return (
    <div className="animate-fade-in-up space-y-6">
      <button type="button" onClick={onBack} className="btn-ghost inline-flex items-center gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to My Performance
      </button>
      <section className="card-glass p-6 md:p-8">
        <div className="mb-6 text-center">
          <HeaderIcon
            className={`mx-auto h-9 w-9 ${
              kind === "interview" ? "text-amber-300" : "text-violet-300"
            }`}
          />
          <h1 className="mt-2 text-2xl font-bold text-zinc-100">{title}</h1>
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        </div>
        {!result && !error && <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-brand-300" /></div>}
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">{error}</p>}
        {result &&
          (kind === "debate" ? (
            <DebateResult result={result as DebateDetailResponse} />
          ) : kind === "gd" ? (
            <GDResult result={result as GDResultsResponse} />
          ) : (
            <InterviewResult result={result as StudentSubmissionDetail} />
          ))}
      </section>
    </div>
  );
}
