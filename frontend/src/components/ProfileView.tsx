import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Calendar,
  Loader2,
  MessageSquareText,
  Mic,
  Swords,
  Trophy,
  Users2,
  User,
  Briefcase,
} from "lucide-react";
import type { AuthUser } from "../types";
import { getCurrentIdToken } from "../hooks/useAuth";

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
}

interface ProfileData {
  stats: ProfileStats;
  recent_debates: DebateSummary[];
  recent_gds: GDSummary[];
  recent_interviews: InterviewSummary[];
  recent_battles: BattleSummary[];
  recent_pronunciations: AttemptSummary[];
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProfileViewProps {
  user: AuthUser;
  onBack: () => void;
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

export function ProfileView({ user, onBack }: ProfileViewProps) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProfileData();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-2xl font-bold text-white">
            {user.displayName?.charAt(0).toUpperCase() || "U"}
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
          </div>
        </div>
      </section>

      {loading && (
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
          {/* Stats overview */}
          <section className="card-glass p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 inline-flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand-300" />
              Performance Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                {data.recent_debates.map((d) => (
                  <li key={d.debate_id} className="bg-zinc-800/50 rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">{d.motion_title}</div>
                      <div className="text-xs text-zinc-500">
                        {d.code} · {d.participant_count} participants · {formatDate(d.completed_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-zinc-100">{Math.round(d.your_score)}</div>
                      <div className="text-xs text-zinc-500">Rank #{d.your_rank}</div>
                    </div>
                    {d.is_winner && (
                      <Trophy className="w-5 h-5 text-amber-300" />
                    )}
                  </li>
                ))}
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
                  <li key={g.session_id} className="bg-zinc-800/50 rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">{g.topic_title}</div>
                      <div className="text-xs text-zinc-500">
                        {g.code} · {g.participant_count} participants · {formatDate(g.completed_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-zinc-100">{Math.round(g.your_score)}</div>
                      <div className="text-xs text-zinc-500">Rank #{g.your_rank}</div>
                    </div>
                    {g.is_winner && (
                      <Trophy className="w-5 h-5 text-amber-300" />
                    )}
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
                  <li key={i.submission_id} className="bg-zinc-800/50 rounded-lg p-3 flex items-center gap-3">
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
                        {i.teacher_score != null && ` · Teacher: ${i.teacher_score}`}
                      </div>
                    </div>
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
