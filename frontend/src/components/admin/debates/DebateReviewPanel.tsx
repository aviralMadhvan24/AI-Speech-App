import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Info,
  Loader2,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Trophy,
} from "lucide-react";
import { getCurrentIdToken } from "../../../hooks/useAuth";

// ---------------------------------------------------------------------------
// Wire types — mirror the JSON shapes returned by /admin/debates/{id}
// (app/debate/admin_routes.py::get_debate) and the request body accepted by
// /admin/debates/{id}/turns/{tid}/review (TeacherReviewRequest).
// ---------------------------------------------------------------------------

interface DebateParticipantSnapshot {
  participant_id: string;
  user_id: string;
  display_name: string;
  turn_index: number;
  is_forfeit: boolean;
}

interface EffectiveScoreEntry {
  participant_id: string;
  ai_score: number;
  teacher_override_score: number | null;
  effective_score: number;
}

interface DebateRecord {
  debate_id: string;
  code: string;
  motion_id: string;
  motion_title: string;
  motion_text: string;
  participants: DebateParticipantSnapshot[];
  turn_ids: string[];
  winner_participant_id: string | null;
  effective_scores: EffectiveScoreEntry[];
  created_at: number;
  completed_at: number;
}

interface DebateTurn {
  turn_id: string;
  debate_id: string;
  participant_id: string;
  turn_index: number;
  analysis_id: string | null;
  // App route serving this turn's recording, or null for forfeits / storage
  // failures. Requires an Authorization header, so playback goes through fetch.
  audio_url: string | null;
  ai_score: number;
  scoring_unavailable: boolean;
  teacher_override_score: number | null;
  teacher_comment: string | null;
  content_score: number | null;
  content_feedback: string | null;
  score_breakdown: {
    pronunciation?: { raw: number | null; weighted: number | null; weight: string };
    fluency?: { raw: number | null; weighted: number | null; weight: string };
    content?: { total: number | null; weight: string; feedback: string };
    final_score?: number;
  } | null;
  submitted_at: number;
  forfeit_reason: "timeout" | "reconnect_timeout" | null;
}

interface DebateDetailResponse {
  debate: DebateRecord;
  turns: DebateTurn[];
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function authedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function fetchDebateDetail(
  debateId: string,
): Promise<DebateDetailResponse> {
  const response = await authedFetch(
    `/admin/debates/${encodeURIComponent(debateId)}`,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Failed to load debate: ${response.status} ${response.statusText}${
        detail ? ` — ${detail.slice(0, 240)}` : ""
      }`,
    );
  }
  return (await response.json()) as DebateDetailResponse;
}

async function submitTurnReview(
  debateId: string,
  turnId: string,
  payload: { score: number; comment: string | null },
): Promise<DebateTurn> {
  const response = await authedFetch(
    `/admin/debates/${encodeURIComponent(debateId)}/turns/${encodeURIComponent(
      turnId,
    )}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 422) {
      throw new Error("Invalid score. Enter an integer between 0 and 100.");
    }
    throw new Error(
      `Review failed: ${response.status} ${response.statusText}${
        detail ? ` — ${detail.slice(0, 240)}` : ""
      }`,
    );
  }
  return (await response.json()) as DebateTurn;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DebateReviewPanelProps {
  debateId: string;
  onBack: () => void;
}

interface RowDraft {
  score: string;
  comment: string;
  submitting: boolean;
  error: string | null;
  savedAt: number | null;
}

function formatUnixDate(unixSeconds: number): string {
  if (!unixSeconds) return "unknown";
  try {
    return new Date(unixSeconds * 1000).toLocaleString();
  } catch {
    return "unknown";
  }
}

function participantNameFor(
  record: DebateRecord | null,
  participantId: string,
): string {
  if (!record) return participantId;
  const match = record.participants.find(
    (p) => p.participant_id === participantId,
  );
  return match?.display_name || `Speaker ${(match?.turn_index ?? 0) + 1}`;
}

export function DebateReviewPanel({
  debateId,
  onBack,
}: DebateReviewPanelProps) {
  const [record, setRecord] = useState<DebateRecord | null>(null);
  const [turns, setTurns] = useState<DebateTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [winnerToast, setWinnerToast] = useState<string | null>(null);
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // The audio route is auth-guarded, so it is fetched with the bearer token and
  // played from an object URL rather than assigned straight to <audio src>.
  const handlePlayTurn = useCallback(
    async (turn: DebateTurn) => {
      if (!turn.audio_url) return;
      setAudioError(null);

      if (playingTurnId === turn.turn_id) {
        audioRef.current?.pause();
        setPlayingTurnId(null);
        return;
      }
      audioRef.current?.pause();

      try {
        const token = await getCurrentIdToken();
        const response = await fetch(turn.audio_url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("Audio not available");
        const blob = await response.blob();

        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.onended = () => setPlayingTurnId(null);
        audio.onerror = () => setPlayingTurnId(null);
        await audio.play();
        setPlayingTurnId(turn.turn_id);
      } catch {
        setPlayingTurnId(null);
        setAudioError("Could not play this turn's audio.");
      }
    },
    [playingTurnId],
  );

  useEffect(() => () => audioRef.current?.pause(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDebateDetail(debateId);
      const sortedTurns = [...data.turns].sort(
        (a, b) => a.turn_index - b.turn_index,
      );
      setRecord(data.debate);
      setTurns(sortedTurns);
      // Seed draft state from existing values.
      const nextDrafts: Record<string, RowDraft> = {};
      for (const turn of sortedTurns) {
        nextDrafts[turn.turn_id] = {
          score:
            turn.teacher_override_score != null
              ? String(turn.teacher_override_score)
              : "",
          comment: turn.teacher_comment ?? "",
          submitting: false,
          error: null,
          savedAt: null,
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load debate.",
      );
    } finally {
      setLoading(false);
    }
  }, [debateId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-clear the winner toast after a few seconds.
  useEffect(() => {
    if (!winnerToast) return;
    const timer = window.setTimeout(() => setWinnerToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [winnerToast]);

  const setDraft = useCallback(
    (turnId: string, patch: Partial<RowDraft>) => {
      setDrafts((prev) => ({
        ...prev,
        [turnId]: { ...prev[turnId], ...patch },
      }));
    },
    [],
  );

  const handleSave = useCallback(
    async (turn: DebateTurn) => {
      const draft = drafts[turn.turn_id];
      if (!draft) return;
      const trimmed = draft.score.trim();
      const parsed = Number(trimmed);
      if (
        !/^-?\d+$/.test(trimmed) ||
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        parsed > 100 ||
        !Number.isInteger(parsed)
      ) {
        setDraft(turn.turn_id, {
          error: "Enter an integer between 0 and 100.",
        });
        return;
      }
      setDraft(turn.turn_id, {
        submitting: true,
        error: null,
        savedAt: null,
      });
      const previousWinner = record?.winner_participant_id ?? null;
      try {
        const updated = await submitTurnReview(debateId, turn.turn_id, {
          score: parsed,
          comment: draft.comment.trim() ? draft.comment.trim() : null,
        });
        // Update local turns list in place with the updated row.
        setTurns((prev) =>
          prev.map((t) => (t.turn_id === updated.turn_id ? updated : t)),
        );
        setDraft(turn.turn_id, {
          submitting: false,
          error: null,
          savedAt: Date.now(),
          score: String(updated.teacher_override_score ?? ""),
          comment: updated.teacher_comment ?? "",
        });
        // Refresh the record to pick up any winner change and any updated
        // effective_scores. Compare the new winner to detect a flip.
        try {
          const refreshed = await fetchDebateDetail(debateId);
          setRecord(refreshed.debate);
          if (
            refreshed.debate.winner_participant_id !== previousWinner &&
            refreshed.debate.winner_participant_id
          ) {
            const name = participantNameFor(
              refreshed.debate,
              refreshed.debate.winner_participant_id,
            );
            setWinnerToast(`Winner updated: ${name}`);
          }
        } catch {
          // Non-fatal — the row-level save already succeeded.
        }
      } catch (err) {
        setDraft(turn.turn_id, {
          submitting: false,
          error:
            err instanceof Error ? err.message : "Could not save review.",
        });
      }
    },
    [debateId, drafts, record, setDraft],
  );

  const winnerName = useMemo(() => {
    if (!record?.winner_participant_id) return null;
    return participantNameFor(record, record.winner_participant_id);
  }, [record]);

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Back to pending debates"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2"
          aria-label="Refresh debate detail"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {winnerToast && (
        <div className="card-glass border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 inline-flex items-center gap-2">
          <Trophy className="w-4 h-4" />
          {winnerToast}
        </div>
      )}

      {loading && !record && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading debate…
        </div>
      )}

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{error}</div>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs font-medium text-rose-200 underline underline-offset-4 hover:text-rose-100"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {record && (
        <>
          <header className="card-glass relative overflow-hidden p-6 md:p-8 space-y-3">
            <div
              aria-hidden
              className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-transparent blur-3xl"
            />
            <div className="relative flex items-center gap-3 flex-wrap">
              <span className="chip bg-violet-500/10 text-violet-300 border border-violet-500/30">
                <MessageSquareText className="w-3 h-3" />
                Debate
              </span>
              <span className="text-zinc-500 text-sm">
                Room{" "}
                <span className="font-mono text-zinc-300 tracking-widest">
                  {record.code}
                </span>
              </span>
              <span className="text-xs text-zinc-500">
                · completed {formatUnixDate(record.completed_at)}
              </span>
            </div>
            <div className="relative">
              <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 tracking-tight">
                {record.motion_title}
              </h1>
              <p className="mt-2 text-sm text-zinc-400 max-w-3xl leading-relaxed">
                {record.motion_text}
              </p>
            </div>
            {winnerName && (
              <div className="relative inline-flex items-center gap-2 chip bg-amber-500/10 text-amber-300 border border-amber-500/30">
                <Trophy className="w-3 h-3" />
                Current winner: {winnerName}
              </div>
            )}
          </header>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2">
              Turns
              <span className="text-sm font-medium text-zinc-500 tabular-nums">
                {turns.length}
              </span>
            </h2>
            {turns.length === 0 && (
              <div className="card-glass px-4 py-3 text-sm text-zinc-400">
                No turns recorded for this debate.
              </div>
            )}
            <ul className="space-y-3" role="list">
              {turns.map((turn) => {
                const draft = drafts[turn.turn_id];
                const speaker = participantNameFor(record, turn.participant_id);
                const isWinner =
                  record.winner_participant_id === turn.participant_id;
                const effective =
                  turn.teacher_override_score != null
                    ? turn.teacher_override_score
                    : turn.ai_score;
                return (
                  <li
                    key={turn.turn_id}
                    className={[
                      "card-glass p-4 md:p-5 space-y-3",
                      isWinner
                        ? "border-amber-500/40 ring-1 ring-amber-500/30"
                        : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-sm font-semibold text-white shrink-0">
                        {speaker.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-zinc-100 truncate">
                          {speaker}
                          {isWinner && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-300 font-semibold">
                              <Trophy className="w-3 h-3" />
                              Winner
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                          Speaker {turn.turn_index + 1}
                          {turn.forfeit_reason &&
                            ` · Forfeit (${turn.forfeit_reason})`}
                          {turn.scoring_unavailable && " · AI unavailable"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                          AI score
                        </div>
                        <div className="text-xl font-bold text-zinc-100 tabular-nums">
                          {turn.ai_score.toFixed(1)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                          Effective
                        </div>
                        <div className="text-xl font-bold text-emerald-300 tabular-nums">
                          {effective.toFixed(1)}
                        </div>
                      </div>
                    </div>

                    {/* Turn audio playback */}
                    {turn.audio_url ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePlayTurn(turn)}
                          aria-label={
                            playingTurnId === turn.turn_id
                              ? `Pause turn ${turn.turn_index + 1} audio`
                              : `Play turn ${turn.turn_index + 1} audio`
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                        >
                          {playingTurnId === turn.turn_id ? (
                            <><Pause className="h-3.5 w-3.5" aria-hidden /> Pause</>
                          ) : (
                            <><Play className="h-3.5 w-3.5" aria-hidden /> Play turn audio</>
                          )}
                        </button>
                        {playingTurnId === turn.turn_id && (
                          <span className="text-[11px] text-zinc-500">Playing…</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-zinc-500">
                        No audio saved for this turn.
                      </p>
                    )}
                    {audioError && playingTurnId === null && (
                      <p className="text-[11px] text-rose-300">{audioError}</p>
                    )}

                    {/* Score breakdown */}
                    {turn.score_breakdown && (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Pronunciation</div>
                          <div className="text-zinc-100 font-semibold">
                            {turn.score_breakdown.pronunciation?.weighted?.toFixed(1) ?? "N/A"}/25
                          </div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Fluency</div>
                          <div className="text-zinc-100 font-semibold">
                            {turn.score_breakdown.fluency?.weighted?.toFixed(1) ?? "N/A"}/25
                          </div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Content</div>
                          <div className="text-zinc-100 font-semibold">
                            {turn.content_score?.toFixed(1) ?? "N/A"}/50
                          </div>
                        </div>
                      </div>
                    )}

                    {/* AI Content Feedback */}
                    {turn.content_feedback && (
                      <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold mb-1">
                          AI Feedback
                        </div>
                        <p className="text-sm text-zinc-300 leading-relaxed">
                          {turn.content_feedback}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-3 items-start">
                      <div>
                        <label
                          htmlFor={`score-${turn.turn_id}`}
                          className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1"
                        >
                          Override (0-100)
                        </label>
                        <input
                          id={`score-${turn.turn_id}`}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="numeric"
                          value={draft?.score ?? ""}
                          onChange={(e) =>
                            setDraft(turn.turn_id, {
                              score: e.target.value,
                              error: null,
                              savedAt: null,
                            })
                          }
                          placeholder="—"
                          className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/60"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`comment-${turn.turn_id}`}
                          className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1"
                        >
                          Comment
                        </label>
                        <textarea
                          id={`comment-${turn.turn_id}`}
                          value={draft?.comment ?? ""}
                          onChange={(e) =>
                            setDraft(turn.turn_id, {
                              comment: e.target.value,
                              savedAt: null,
                            })
                          }
                          rows={2}
                          placeholder="Optional feedback for the student…"
                          className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60 resize-y min-h-[3rem]"
                        />
                      </div>
                      <div className="flex md:flex-col items-end gap-2 md:justify-start">
                        <button
                          type="button"
                          onClick={() => void handleSave(turn)}
                          disabled={draft?.submitting}
                          className="btn-primary px-4 py-2 text-xs"
                        >
                          {draft?.submitting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Save review
                            </>
                          )}
                        </button>
                        {draft?.savedAt && !draft.error && (
                          <span className="chip-emerald">
                            <Check className="w-3 h-3" />
                            Saved
                          </span>
                        )}
                      </div>
                    </div>

                    {draft?.error && (
                      <div className="text-xs text-rose-300">
                        {draft.error}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
