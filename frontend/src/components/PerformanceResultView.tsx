import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Loader2, Trophy, Users2 } from "lucide-react";
import {
  getDebateDetail,
  type DebateDetailResponse,
  type FinalStanding,
  type ScoreBreakdown,
} from "../debateApi";
import { getGDSessionDetail, type GDResultsResponse } from "../gdApi";
import { DebateTurnsAudio } from "./DebateTurnsAudio";

type PerformanceResultKind = "debate" | "gd";

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

  const rows: { label: string; value: number | null; max: number; note?: string }[] = [
    { label: "Pronunciation", value: pronunciation, max: 25, note: breakdown.pronunciation?.raw != null ? `raw ${Math.round(breakdown.pronunciation.raw)}/100` : undefined },
    { label: "Fluency", value: fluency, max: 25, note: breakdown.fluency?.raw != null ? `clarity ${Math.round(breakdown.fluency.raw)}/100` : undefined },
    { label: "Content", value: content, max: 50 },
  ];

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-700/60 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Score breakdown
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg bg-zinc-800/60 p-2">
            <div className="text-[11px] text-zinc-400">{row.label}</div>
            <div className={`text-sm font-semibold tabular-nums ${componentTone(row.value, row.max)}`}>
              {row.value != null ? row.value.toFixed(1) : "Not scored"}
              <span className="text-[11px] font-normal text-zinc-500">/{row.max}</span>
            </div>
            {row.note && <div className="text-[10px] text-zinc-500">{row.note}</div>}
          </div>
        ))}
      </div>

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
          </article>
        );
      })}
    </div>
  );
}

export function PerformanceResultView({ kind, id, onBack }: PerformanceResultViewProps) {
  const [result, setResult] = useState<DebateDetailResponse | GDResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    setResult(null);
    setError(null);

    // A detailed debate finishes scoring in a background task, so the first
    // response is often still "being prepared". Poll until it lands instead of
    // making the user reload the page.
    const isStillPending = (data: DebateDetailResponse | GDResultsResponse): boolean => {
      if (kind !== "debate") return false;
      const debate = data as DebateDetailResponse;
      return (
        debate.scoring_mode === "detailed" &&
        debate.final_standings.some((standing) => !standing.full_score_ready)
      );
    };

    const fetchResult = () => {
      const load = kind === "debate" ? getDebateDetail(id) : getGDSessionDetail(id);
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

  const title = kind === "debate" ? "Debate Result" : "Group Discussion Result";
  const subtitle = result
    ? kind === "debate"
      ? (result as DebateDetailResponse).motion.title
      : (result as GDResultsResponse).topic.title
    : "Loading final result";

  return (
    <div className="animate-fade-in-up space-y-6">
      <button type="button" onClick={onBack} className="btn-ghost inline-flex items-center gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to My Performance
      </button>
      <section className="card-glass p-6 md:p-8">
        <div className="mb-6 text-center">
          <Users2 className="mx-auto h-9 w-9 text-violet-300" />
          <h1 className="mt-2 text-2xl font-bold text-zinc-100">{title}</h1>
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        </div>
        {!result && !error && <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-brand-300" /></div>}
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">{error}</p>}
        {result && (kind === "debate" ? <DebateResult result={result as DebateDetailResponse} /> : <GDResult result={result as GDResultsResponse} />)}
      </section>
    </div>
  );
}
