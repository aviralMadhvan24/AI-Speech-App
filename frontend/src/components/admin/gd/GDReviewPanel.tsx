import { useCallback, useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  Check,
  Info,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Trophy,
  Users2,
} from "lucide-react";
import { getCurrentIdToken } from "../../../hooks/useAuth";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface GDParticipant {
  participant_id: string;
  user_id: string;
  display_name: string;
  joined_at: number;
}

interface GDParticipantScore {
  participant_id: string;
  display_name: string;
  // Score breakdown (matches backend GDParticipantScore)
  total_score: number;
  content_quality: number;  // 0-30
  communication: number;    // 0-20
  participation: number;    // 0-20
  listening: number;        // 0-15
  leadership: number;       // 0-15
  // Stats
  speech_count: number;
  total_speak_seconds: number;
  interruption_count: number;
  was_interrupted_count: number;
  feedback: string | null;
  rank: number;
}

interface GDSession {
  session_id: string;
  code: string;
  topic_id: string;
  topic_title: string;
  topic_text: string;
  participants: GDParticipant[];
  speech_ids: string[];
  scores: GDParticipantScore[];
  winner_participant_id: string | null;
  created_at: number;
  completed_at: number;
}

interface GDSpeech {
  speech_id: string;
  session_id: string;
  participant_id: string;
  display_name: string;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  transcript: string | null;
  audio_ref: string | null;
}

interface GDDetailResponse {
  session: GDSession;
  speeches: GDSpeech[];
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function fetchGDDetail(sessionId: string): Promise<GDDetailResponse> {
  const response = await authedFetch(`/admin/gd/${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to load session: ${response.status} ${detail.slice(0, 240)}`);
  }
  return (await response.json()) as GDDetailResponse;
}

async function submitGDReview(
  sessionId: string,
  participantId: string,
  payload: { score: number; comment: string | null },
): Promise<{ teacher_score: number; teacher_comment: string | null }> {
  const response = await authedFetch(`/admin/gd/${encodeURIComponent(sessionId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant_id: participantId,
      score: payload.score,
      comment: payload.comment,
    }),
  });
  if (!response.ok) {
    if (response.status === 422) {
      throw new Error("Invalid score. Enter an integer between 0 and 100.");
    }
    throw new Error(`Review failed: ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GDReviewPanelProps {
  sessionId: string;
  onBack: () => void;
}

interface ParticipantDraft {
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function GDReviewPanel({ sessionId, onBack }: GDReviewPanelProps) {
  const [session, setSession] = useState<GDSession | null>(null);
  const [speeches, setSpeeches] = useState<GDSpeech[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ParticipantDraft>>({});
  const [playingSpeechId, setPlayingSpeechId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGDDetail(sessionId);
      setSession(data.session);
      setSpeeches(data.speeches.sort((a, b) => a.started_at - b.started_at));
      
      // Seed draft state
      const nextDrafts: Record<string, ParticipantDraft> = {};
      for (const score of data.session.scores) {
        nextDrafts[score.participant_id] = {
          score: score.total_score ? String(Math.round(score.total_score)) : "",
          comment: "",
          submitting: false,
          error: null,
          savedAt: null,
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const setDraft = useCallback((participantId: string, patch: Partial<ParticipantDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [participantId]: { ...prev[participantId], ...patch },
    }));
  }, []);

  const handleSave = useCallback(
    async (participantId: string) => {
      const draft = drafts[participantId];
      if (!draft) return;
      
      const trimmed = draft.score.trim();
      const parsed = Number(trimmed);
      if (!/^\d+$/.test(trimmed) || parsed < 0 || parsed > 100) {
        setDraft(participantId, { error: "Enter an integer between 0 and 100." });
        return;
      }
      
      setDraft(participantId, { submitting: true, error: null, savedAt: null });
      
      try {
        await submitGDReview(sessionId, participantId, {
          score: parsed,
          comment: draft.comment.trim() || null,
        });
        setDraft(participantId, {
          submitting: false,
          error: null,
          savedAt: Date.now(),
        });
        // Refresh to get updated rankings
        await load();
      } catch (err) {
        setDraft(participantId, {
          submitting: false,
          error: err instanceof Error ? err.message : "Could not save review.",
        });
      }
    },
    [sessionId, drafts, setDraft, load],
  );

  const handlePlaySpeech = async (speech: GDSpeech) => {
    if (!speech.audio_ref) return;
    
    // If already playing this speech, pause it
    if (playingSpeechId === speech.speech_id) {
      audioRef.current?.pause();
      setPlayingSpeechId(null);
      return;
    }
    
    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    // Get auth token and play
    const token = await getCurrentIdToken();
    const audioUrl = `/admin/gd/${sessionId}/speech/${speech.speech_id}/audio`;
    
    const audio = new Audio();
    audioRef.current = audio;
    
    // Set auth header via fetch and blob
    try {
      const response = await fetch(audioUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Audio not available");
      const blob = await response.blob();
      audio.src = URL.createObjectURL(blob);
      
      audio.onended = () => setPlayingSpeechId(null);
      audio.onerror = () => setPlayingSpeechId(null);
      
      await audio.play();
      setPlayingSpeechId(speech.speech_id);
    } catch {
      setPlayingSpeechId(null);
    }
  };

  const winnerName = session?.winner_participant_id
    ? session.participants.find((p) => p.participant_id === session.winner_participant_id)?.display_name
    : null;

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
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && !session && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading session…
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
              className="mt-2 text-xs font-medium text-rose-200 underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {session && (
        <>
          <header className="card-glass relative overflow-hidden p-6 md:p-8 space-y-3">
            <div
              aria-hidden
              className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/25 via-brand-500/15 to-transparent blur-3xl"
            />
            <div className="relative flex items-center gap-3 flex-wrap">
              <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                <Users2 className="w-3 h-3" />
                Group Discussion
              </span>
              <span className="text-zinc-500 text-sm">
                Room <span className="font-mono text-zinc-300 tracking-widest">{session.code}</span>
              </span>
              <span className="text-xs text-zinc-500">
                · completed {formatUnixDate(session.completed_at)}
              </span>
            </div>
            <div className="relative">
              <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 tracking-tight">
                {session.topic_title}
              </h1>
              <p className="mt-2 text-sm text-zinc-400 max-w-3xl leading-relaxed">
                {session.topic_text}
              </p>
            </div>
            {winnerName && (
              <div className="relative inline-flex items-center gap-2 chip bg-amber-500/10 text-amber-300 border border-amber-500/30">
                <Trophy className="w-3 h-3" />
                Winner: {winnerName}
              </div>
            )}
          </header>

          {/* Participants & Scores */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2">
              Participants
              <span className="text-sm font-medium text-zinc-500 tabular-nums">
                {session.scores.length}
              </span>
            </h2>
            
            <ul className="space-y-3" role="list">
              {session.scores
                .sort((a, b) => a.rank - b.rank)
                .map((score) => {
                  const draft = drafts[score.participant_id];
                  const isWinner = session.winner_participant_id === score.participant_id;
                  
                  return (
                    <li
                      key={score.participant_id}
                      className={[
                        "card-glass p-4 md:p-5 space-y-3",
                        isWinner ? "border-amber-500/40 ring-1 ring-amber-500/30" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <div
                          className={[
                            "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                            score.rank === 1 ? "bg-amber-500/20 text-amber-300" : "bg-zinc-800 text-zinc-400",
                          ].join(" ")}
                        >
                          #{score.rank}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-zinc-100 truncate">
                            {score.display_name}
                            {isWinner && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-300 font-semibold">
                                <Trophy className="w-3 h-3" />
                                Winner
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                            {score.speech_count ?? 0} speeches ·{" "}
                            {formatDuration(score.total_speak_seconds ?? 0)} total
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                            Score
                          </div>
                          <div className="text-xl font-bold text-emerald-300 tabular-nums">
                            {Math.round(score.total_score)}
                          </div>
                        </div>
                      </div>

                      {/* Stats breakdown */}
                      <div className="grid grid-cols-5 gap-2 text-xs">
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Content</div>
                          <div className="text-zinc-100 font-semibold">{Math.round(score.content_quality)}/30</div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Comm</div>
                          <div className="text-zinc-100 font-semibold">{Math.round(score.communication)}/20</div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Participation</div>
                          <div className="text-zinc-100 font-semibold">{Math.round(score.participation)}/20</div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Listening</div>
                          <div className="text-zinc-100 font-semibold">{Math.round(score.listening)}/15</div>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-2">
                          <div className="text-zinc-400">Leadership</div>
                          <div className="text-zinc-100 font-semibold">{Math.round(score.leadership)}/15</div>
                        </div>
                      </div>

                      {/* AI Feedback */}
                      {score.feedback && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                          <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-1">
                            AI Feedback
                          </div>
                          <p className="text-sm text-zinc-300 leading-relaxed">{score.feedback}</p>
                        </div>
                      )}

                      {/* Teacher override */}
                      <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-3 items-start">
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
                            Override (0-100)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={draft?.score ?? ""}
                            onChange={(e) =>
                              setDraft(score.participant_id, {
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
                          <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
                            Comment
                          </label>
                          <textarea
                            value={draft?.comment ?? ""}
                            onChange={(e) =>
                              setDraft(score.participant_id, {
                                comment: e.target.value,
                                savedAt: null,
                              })
                            }
                            rows={2}
                            placeholder="Optional feedback…"
                            className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60 resize-y min-h-[3rem]"
                          />
                        </div>
                        <div className="flex md:flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSave(score.participant_id)}
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
                                Save
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
                      {draft?.error && <div className="text-xs text-rose-300">{draft.error}</div>}
                    </li>
                  );
                })}
            </ul>
          </section>

          {/* Speeches Timeline */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Speeches
              <span className="text-sm font-medium text-zinc-500 tabular-nums">{speeches.length}</span>
            </h2>
            
            <ul className="space-y-2" role="list">
              {speeches.map((speech, idx) => (
                <li key={speech.speech_id} className="card-glass p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-brand-500 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                    {speech.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-100 truncate">
                      {speech.display_name}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      #{idx + 1} · {formatDuration(speech.duration_seconds)}
                      {speech.transcript && ` · "${speech.transcript.slice(0, 50)}..."`}
                    </div>
                  </div>
                  {speech.audio_ref && (
                    <button
                      type="button"
                      onClick={() => void handlePlaySpeech(speech)}
                      className="btn-ghost p-2 text-zinc-400 hover:text-zinc-100"
                    >
                      {playingSpeechId === speech.speech_id ? (
                        <Pause className="w-4 h-4 text-brand-300" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
