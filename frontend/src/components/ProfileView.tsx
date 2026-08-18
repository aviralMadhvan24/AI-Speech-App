import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Loader2,
  MessageSquareText,
  Mic,
  Swords,
  Trophy,
  Users2,
  User,
  Briefcase,
  Flame,
  X,
} from "lucide-react";
import type { AuthUser } from "../types";
import { getCurrentIdToken } from "../hooks/useAuth";
import { type DebateTurnAudioRef } from "../debateApi";
import { DebateTurnsAudio } from "./DebateTurnsAudio";
import { fetchPotd, type PotdChallenge } from "../potdApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DebateSummary {
  debate_id: string;
  code: string;
  motion_title: string;
  participant_count: number;
  your_score: number;
  your_rank: number;
  is_winner: boolean;
  scoring_mode: "instant" | "detailed";
  result_pending: boolean;
  completed_at: number;
}

interface GDSummary {
  session_id: string;
  code: string;
  topic_title: string;
  participant_count: number;
  your_score: number;
  your_rank: number;
  is_winner: boolean;
  scoring_mode: "instant" | "detailed";
  result_pending: boolean;
  completed_at: number;
}

interface InterviewSummary {
  submission_id: string;
  question_prompt: string;
  gesture_score: number;
  teacher_score: number | null;
  combined_score: number | null;
  status: string;
  submitted_at: string;
  pronunciation_score: number | null;
  pronunciation_pending: boolean;
}

interface BattleSummary {
  battle_id: string;
  code: string;
  your_score: number;
  opponent_score: number;
  is_winner: boolean;
  completed_at: number;
}

interface AttemptSummary {
  sessionId: string;
  sentencePreview: string;
  score: number;
  createdAt: string;
}

interface ProfileStats {
  total_debates: number;
  debate_wins: number;
  total_gds: number;
  gd_wins: number;
  total_interviews: number;
  avg_interview_score: number;
  total_battles: number;
  battle_wins: number;
  total_pronunciations: number;
  avg_pronunciation_score: number;
  points: number;
  active_days: number;
  current_streak: number;
  max_streak: number;
  total_submissions: number;
}

interface ProfileData {
  avatar_url: string | null;
  stats: ProfileStats;
  recent_debates: DebateSummary[];
  recent_gds: GDSummary[];
  recent_interviews: InterviewSummary[];
  recent_battles: BattleSummary[];
  recent_pronunciations: AttemptSummary[];
  activity: Array<{ date: string; count: number; level: number }>;
  badges: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchProfileData(): Promise<ProfileData> {
  const token = await getCurrentIdToken();
  const res = await fetch("/profile/summary", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

async function uploadAvatar(file: File): Promise<string | null> {
  const token = await getCurrentIdToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/profile/avatar", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let detail = `Upload failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore parse errors, keep the generic message
    }
    throw new Error(detail);
  }
  const body = (await res.json()) as { avatar_url: string | null };
  return body.avatar_url;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProfileViewProps {
  user: AuthUser;
  onBack: () => void;
  /** Called after the avatar changes so the app header can refresh. */
  onAvatarChange?: () => void | Promise<void>;
  onOpenDebateResult: (debateId: string) => void;
  onOpenGDResult: (sessionId: string) => void;
  onOpenInterviewResult: (submissionId: string) => void;
}

function formatDate(dateStr: string | number): string {
  try {
    const date = typeof dateStr === "number" 
      ? new Date(dateStr * 1000) 
      : new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

function activityColor(level: number): string {
  if (level >= 4) return "bg-emerald-400";
  if (level === 3) return "bg-emerald-500/80";
  if (level === 2) return "bg-emerald-600/70";
  if (level === 1) return "bg-emerald-700/70";
  return "bg-zinc-800";
}

export function ProfileView({ user, onBack, onAvatarChange, onOpenDebateResult, onOpenGDResult, onOpenInterviewResult }: ProfileViewProps) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [potd, setPotd] = useState<PotdChallenge | null>(null);
  // Pending selection awaiting Save/Cancel: the chosen file plus a local
  // object-URL used only for the preview (revoked once resolved).
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProfileData();
      setData(result);
      setAvatarUrl(result.avatar_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Detailed debates / GDs finish scoring in a background task, and interviews
  // run their pronunciation pass the same way, so entries can arrive as
  // "Processing". Refresh until they resolve. The stats already on screen are
  // kept during these refreshes.
  const hasPendingResult =
    (data?.recent_debates?.some((d) => d.result_pending) ?? false) ||
    (data?.recent_gds?.some((g) => g.result_pending) ?? false) ||
    (data?.recent_interviews?.some((i) => i.pronunciation_pending) ?? false);

  useEffect(() => {
    if (!hasPendingResult) return;
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [hasPendingResult, load]);

  useEffect(() => {
    void fetchPotd().then(setPotd).catch(() => undefined);
  }, []);

  // Step 1: user picks a file → stage it and show a local preview. Nothing
  // is uploaded until they confirm with Save.
  const handleSelectFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so selecting the same file again still fires onChange.
      event.target.value = "";
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setAvatarError("Please choose an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setAvatarError("Image too large. Maximum size is 5 MB.");
        return;
      }

      setAvatarError(null);
      // Revoke any previous preview URL before creating a new one.
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setPendingFile(file);
    },
    [],
  );

  const clearPending = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPendingFile(null);
  }, []);

  // Step 2a: discard the staged photo.
  const handleCancel = useCallback(() => {
    setAvatarError(null);
    clearPending();
  }, [clearPending]);

  // Step 2b: confirm → upload the staged photo and make it the avatar.
  const handleSave = useCallback(async () => {
    if (!pendingFile) return;
    setUploading(true);
    setAvatarError(null);
    try {
      const url = await uploadAvatar(pendingFile);
      setAvatarUrl(url);
      clearPending();
      // Let the app refresh the shared user so the header updates too.
      await onAvatarChange?.();
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : "Failed to upload photo",
      );
    } finally {
      setUploading(false);
    }
  }, [pendingFile, clearPending, onAvatarChange]);

  // Revoke the preview object URL if the component unmounts mid-selection.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-violet-300 bg-violet-500/10 border border-violet-500/30 px-3 py-1 rounded-full">
          <User className="w-3.5 h-3.5" />
          <span>My Profile</span>
        </div>
      </div>

      {/* User info card */}
      <section className="card-glass relative overflow-hidden p-6 md:p-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-transparent blur-3xl"
        />
        <div className="relative flex items-center gap-4">
          <div className="relative group">
            <div
              className={[
                "w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-2xl font-bold text-white ring-2",
                previewUrl ? "ring-brand-400/70" : "ring-white/10",
              ].join(" ")}
            >
              {previewUrl || avatarUrl ? (
                <img
                  src={previewUrl ?? avatarUrl ?? undefined}
                  alt={`${user.displayName || "User"} avatar`}
                  className="w-full h-full object-cover"
                />
              ) : (
                user.displayName?.charAt(0).toUpperCase() || "U"
              )}
            </div>
            {/* Hide the "pick a file" button while previewing so the choice is
                explicitly Save or Cancel. */}
            {!previewUrl && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="Change profile photo"
                title="Change profile photo"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-zinc-900 border border-white/20 flex items-center justify-center text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-60"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleSelectFile}
              className="hidden"
            />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-100">
              {user.displayName}
            </h1>
            <p className="text-sm text-zinc-400">{user.email}</p>
            <div className="mt-1 inline-flex items-center gap-2">
              <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                {user.role === "teacher" ? "Teacher" : "Student"}
              </span>
            </div>

            {/* Preview confirmation: Save or Cancel the staged photo. */}
            {previewUrl && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-zinc-400 mr-1">
                  Preview — save this photo?
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  {uploading ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-xs font-medium px-3 py-1.5 transition disabled:opacity-60"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            )}

            {avatarError && (
              <p className="mt-2 text-xs text-rose-300">{avatarError}</p>
            )}
          </div>
        </div>
      </section>

      {/* Only shown on the very first load. Once stats exist they stay on
          screen during a refresh, so a single debate still preparing its
          detailed result never blanks out the whole page. */}
      {loading && !data && (
        <div className="card-glass p-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-brand-300" />
          <span className="text-sm text-zinc-400">Loading your stats...</span>
        </div>
      )}

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {data && (
        <>
          {potd && (
            <section className="card-glass p-6 border-orange-500/20">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div><h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2"><Flame className="w-5 h-5 text-orange-300" />Problem of the Day streak</h2><p className="mt-1 text-sm text-zinc-400">Keep showing up to unlock stronger badges.</p></div>
              <div className="flex items-center gap-5 text-center"><div><div className="text-2xl font-bold text-orange-200">{potd.current_streak}</div><div className="text-xs text-zinc-500">current</div></div><div><div className="text-2xl font-bold text-zinc-100">{potd.best_streak}</div><div className="text-xs text-zinc-500">best</div></div>{potd.badge && <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{potd.badge}</div>}</div>
              </div>
            </section>
          )}

          <section className="card-glass p-6 overflow-hidden">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div><h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2"><Calendar className="w-5 h-5 text-emerald-300" />Activity</h2><p className="mt-1 text-sm text-zinc-400">Every meaningful activity counts toward your streak and points.</p></div>
              <div className="flex items-center gap-4 text-center"><div><div className="text-xl font-bold text-amber-200">{data.stats.points}</div><div className="text-[11px] text-zinc-500">points</div></div><div><div className="text-xl font-bold text-zinc-100">{data.stats.total_submissions}</div><div className="text-[11px] text-zinc-500">events</div></div><div><div className="text-xl font-bold text-emerald-300">{data.stats.active_days}</div><div className="text-[11px] text-zinc-500">active days</div></div><div><div className="text-xl font-bold text-orange-200">{data.stats.max_streak}</div><div className="text-[11px] text-zinc-500">max streak</div></div></div>
            </div>
            <div className="mt-6 overflow-x-auto pb-2">
              <div className="min-w-[760px]">
                <div className="grid grid-rows-7 grid-flow-col auto-cols-[13px] gap-1" aria-label="Activity heatmap">
                  {data.activity.map((day) => <div key={day.date} title={`${day.date}: ${day.count} ${day.count === 1 ? "event" : "events"}`} className={`h-3 w-3 rounded-sm ${activityColor(day.level)}`} />)}
                </div>
                <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-zinc-500"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <span key={level} className={`h-3 w-3 rounded-sm ${activityColor(level)}`} />)}<span>More</span></div>
              </div>
            </div>
          </section>

          {data.badges.length > 0 && <section className="card-glass p-6"><h2 className="text-lg font-semibold text-zinc-100 inline-flex items-center gap-2"><Award className="w-5 h-5 text-amber-300" />Badges</h2><div className="mt-4 flex flex-wrap gap-3">{data.badges.map((badge) => <div key={badge} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"><Trophy className="w-4 h-4" />{badge}</div>)}</div></section>}
          {/* Stats overview */}
          <section className="card-glass p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand-300" />
              Performance Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
                <Trophy className="w-6 h-6 mx-auto text-amber-300 mb-2" />
                <div className="text-2xl font-bold text-amber-200">{data.stats.points ?? 0}</div>
                <div className="text-xs text-zinc-400">Points</div>
                <div className="text-xs text-amber-300 mt-1">Earned from activity</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
                <MessageSquareText className="w-6 h-6 mx-auto text-violet-300 mb-2" />
                <div className="text-2xl font-bold text-zinc-100">{data.stats.total_debates}</div>
                <div className="text-xs text-zinc-400">Debates</div>
                <div className="text-xs text-emerald-300 mt-1">{data.stats.debate_wins} wins</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
                <Users2 className="w-6 h-6 mx-auto text-emerald-300 mb-2" />
                <div className="text-2xl font-bold text-zinc-100">{data.stats.total_gds}</div>
                <div className="text-xs text-zinc-400">GDs</div>
                <div className="text-xs text-emerald-300 mt-1">{data.stats.gd_wins} wins</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
                <Briefcase className="w-6 h-6 mx-auto text-amber-300 mb-2" />
                <div className="text-2xl font-bold text-zinc-100">{data.stats.total_interviews}</div>
                <div className="text-xs text-zinc-400">Interviews</div>
                <div className="text-xs text-amber-300 mt-1">
                  {data.stats.avg_interview_score > 0 ? `${Math.round(data.stats.avg_interview_score)}% avg` : "N/A"}
                </div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
                <Swords className="w-6 h-6 mx-auto text-fuchsia-300 mb-2" />
                <div className="text-2xl font-bold text-zinc-100">{data.stats.total_battles}</div>
                <div className="text-xs text-zinc-400">Battles</div>
                <div className="text-xs text-emerald-300 mt-1">{data.stats.battle_wins} wins</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 text-center">
                <Mic className="w-6 h-6 mx-auto text-brand-300 mb-2" />
                <div className="text-2xl font-bold text-zinc-100">{data.stats.total_pronunciations}</div>
                <div className="text-xs text-zinc-400">Practices</div>
                <div className="text-xs text-brand-300 mt-1">
                  {data.stats.avg_pronunciation_score > 0 ? `${Math.round(data.stats.avg_pronunciation_score)}% avg` : "N/A"}
                </div>
              </div>
            </div>
          </section>

          {/* Recent Debates */}
          {data.recent_debates.length > 0 && (
            <section className="card-glass p-6">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
                <MessageSquareText className="w-5 h-5 text-violet-300" />
                Recent Debates
              </h2>
              <ul className="space-y-2">
                {data.recent_debates.map((d) => {
                  // Result details now open on their own My Performance page.
                  // Keep the old playback panel closed; the result page is the
                  // canonical destination for both instant and detailed runs.
                  const isExpanded = d.debate_id === "__playback_panel_disabled__";
                  const isLoading = false;
                  const turnAudio: DebateTurnAudioRef[] | undefined = [];
                  const audioError: string | undefined = undefined;
                  const panelId = `debate-audio-${d.debate_id}`;
                  const showSummary = !d.result_pending && d.scoring_mode === "instant";
                  return (
                    <li
                      key={d.debate_id}
                      className="bg-zinc-800/50 rounded-lg overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenDebateResult(d.debate_id)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        className="w-full p-3 flex items-center gap-3 text-left hover:bg-zinc-800/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-100 truncate">{d.motion_title}</div>
                          <div className="text-xs text-zinc-500">
                            {d.code} · {d.participant_count} participants · {formatDate(d.completed_at)}
                          </div>
                        </div>
                        <div className="text-right">
                          {!showSummary ? (
                            <div className="text-xs font-medium text-amber-300">{d.result_pending ? "Processing" : "View result"}</div>
                          ) : (
                            <><div className="text-lg font-bold text-zinc-100">{Math.round(d.your_score)}</div><div className="text-xs text-zinc-500">Rank #{d.your_rank}</div></>
                          )}
                        </div>
                        {showSummary && d.is_winner && (
                          <Trophy className="w-5 h-5 text-amber-300" aria-hidden />
                        )}
                        <ChevronDown
                          className={[
                            "w-4 h-4 text-zinc-400 transition-transform",
                            isExpanded ? "rotate-180" : "",
                          ].join(" ")}
                          aria-hidden
                        />
                      </button>

                      {isExpanded && (
                        <div id={panelId} className="px-3 pb-3">
                          {isLoading && (
                            <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
                              <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
                              Loading turn audio…
                            </div>
                          )}
                          {!isLoading && audioError && (
                            <p className="py-2 text-xs text-rose-300">{audioError}</p>
                          )}
                          {!isLoading && !audioError && turnAudio && (
                            turnAudio.length > 0 ? (
                              <DebateTurnsAudio
                                turns={turnAudio}
                                title="Turn Playback"
                              />
                            ) : (
                              <p className="py-2 text-xs text-zinc-500">
                                No turn audio available for this debate.
                              </p>
                            )
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Recent GDs */}
          {data.recent_gds.length > 0 && (
            <section className="card-glass p-6">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
                <Users2 className="w-5 h-5 text-emerald-300" />
                Recent Group Discussions
              </h2>
              <ul className="space-y-2">
                {data.recent_gds.map((g) => (
                  <li key={g.session_id} className="bg-zinc-800/50 rounded-lg overflow-hidden">
                    <button type="button" onClick={() => onOpenGDResult(g.session_id)} className="w-full p-3 flex items-center gap-3 text-left hover:bg-zinc-800/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">{g.topic_title}</div>
                      <div className="text-xs text-zinc-500">
                        {g.code} · {g.participant_count} participants · {formatDate(g.completed_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      {(!g.result_pending && g.scoring_mode === "instant") ? (
                        <><div className="text-lg font-bold text-zinc-100">{Math.round(g.your_score)}</div><div className="text-xs text-zinc-500">Rank #{g.your_rank}</div></>
                      ) : (
                        <div className="text-xs font-medium text-amber-300">{g.result_pending ? "Processing" : "View result"}</div>
                      )}
                    </div>
                    {!g.result_pending && g.scoring_mode === "instant" && g.is_winner && (
                      <Trophy className="w-5 h-5 text-amber-300" />
                    )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recent Interviews */}
          {data.recent_interviews.length > 0 && (
            <section className="card-glass p-6">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-amber-300" />
                Recent Interviews
              </h2>
              <ul className="space-y-2">
                {data.recent_interviews.map((i) => (
                  <li key={i.submission_id} className="bg-zinc-800/50 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => onOpenInterviewResult(i.submission_id)}
                      className="w-full p-3 flex items-center gap-3 text-left hover:bg-zinc-800/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-zinc-100 truncate">{i.question_prompt}</div>
                        <div className="text-xs text-zinc-500">
                          {formatDate(i.submitted_at)} · {i.status}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-zinc-100">
                          {i.combined_score != null ? Math.round(i.combined_score) : i.gesture_score}
                        </div>
                        <div className="text-xs text-zinc-500">
                          Gesture: {i.gesture_score}
                          {i.pronunciation_pending
                            ? " · Pronunciation: processing"
                            : i.pronunciation_score != null
                              ? ` · Pronunciation: ${Math.round(i.pronunciation_score)}`
                              : ""}
                          {i.teacher_score != null && ` · Teacher: ${i.teacher_score}`}
                        </div>
                      </div>
                      <ChevronDown className="w-4 h-4 -rotate-90 text-zinc-400" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recent Pronunciations */}
          {data.recent_pronunciations.length > 0 && (
            <section className="card-glass p-6">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
                <Mic className="w-5 h-5 text-brand-300" />
                Recent Practice Sessions
              </h2>
              <ul className="space-y-2">
                {data.recent_pronunciations.slice(0, 5).map((p) => (
                  <li key={p.sessionId} className="bg-zinc-800/50 rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">{p.sentencePreview}</div>
                      <div className="text-xs text-zinc-500">{formatDate(p.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${p.score >= 70 ? "text-emerald-300" : "text-zinc-100"}`}>
                        {Math.round(p.score)}%
                      </div>
                    </div>
                    {p.score >= 90 && <Award className="w-5 h-5 text-amber-300" />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Empty state */}
          {data.recent_debates.length === 0 &&
            data.recent_gds.length === 0 &&
            data.recent_interviews.length === 0 &&
            data.recent_pronunciations.length === 0 && (
              <div className="card-glass p-8 text-center">
                <Calendar className="w-10 h-10 mx-auto text-zinc-500 mb-3" />
                <h3 className="text-lg font-semibold text-zinc-100">No activity yet</h3>
                <p className="text-sm text-zinc-400 mt-1">
                  Start practicing to see your progress here!
                </p>
              </div>
            )}
        </>
      )}
    </div>
  );
}
