import { useEffect, useState } from "react";
import { ArrowLeft, Flame, Lock, Mic, Play, Sparkles, Trophy, Video } from "lucide-react";
import { fetchPotd, type PotdChallenge } from "../potdApi";

interface PotdViewProps { onBack: () => void; onStart: (challenge: PotdChallenge) => void; }

export function PotdView({ onBack, onStart }: PotdViewProps) {
  const [challenge, setChallenge] = useState<PotdChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetchPotd().then(setChallenge).catch((e) => setError(e instanceof Error ? e.message : "Could not load today's problem.")); }, []);
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="btn-ghost inline-flex items-center gap-2"><ArrowLeft className="w-4 h-4" />Back</button>
        <span className="chip bg-orange-500/10 text-orange-300 border border-orange-500/30 inline-flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" />Problem of the Day</span>
      </div>
      {error && <div className="card-glass p-4 text-sm text-rose-300">{error}</div>}
      {!challenge && !error && <div className="card-glass p-10 text-center text-zinc-400">Loading today's challenge…</div>}
      {challenge && <>
        <section className="card-glass relative overflow-hidden p-6 md:p-10">
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div><div className="text-xs uppercase tracking-widest text-orange-300">{challenge.date} · {challenge.type === "pronunciation" ? "Pronunciation" : "Interview Studio"}</div><h1 className="mt-3 text-3xl md:text-4xl font-bold">Today's soft-skill challenge</h1><p className="mt-3 max-w-2xl text-zinc-400">One focused attempt every day. Complete it to keep your streak alive and earn performance badges.</p></div>
            <div className="rounded-2xl border border-orange-500/25 bg-orange-500/10 px-5 py-4 text-center"><Flame className="mx-auto h-7 w-7 text-orange-300" /><div className="mt-1 text-3xl font-bold">{challenge.current_streak}</div><div className="text-xs text-zinc-400">day streak</div></div>
          </div>
        </section>
        <section className="grid gap-5 md:grid-cols-[1fr_280px]">
          <article className="card-glass p-6 md:p-8"><div className="flex items-center gap-3 text-sm text-zinc-400">{challenge.type === "pronunciation" ? <Mic className="text-brand-300" /> : <Video className="text-amber-300" />}<span>{challenge.title} · {challenge.category}</span></div><h2 className="mt-6 text-xl font-semibold text-zinc-100">{challenge.prompt}</h2>{challenge.hint && <p className="mt-3 text-sm text-zinc-400">{challenge.hint}</p>}<button type="button" onClick={() => onStart(challenge)} disabled={challenge.completed} className="mt-7 btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">{challenge.completed ? <Lock className="w-4 h-4" /> : <Play className="w-4 h-4" />}{challenge.completed ? `Completed · ${Math.round(challenge.score ?? 0)}%` : "Start today's problem"}</button></article>
          <aside className="card-glass p-6"><h3 className="font-semibold text-zinc-100 inline-flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-300" />Your progress</h3><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><span className="text-zinc-400">Best streak</span><span className="font-semibold">{challenge.best_streak} days</span></div><div className="flex justify-between"><span className="text-zinc-400">Monthly rule</span><span className="text-emerald-300">No repeats</span></div><p className="pt-3 border-t border-zinc-800 text-xs text-zinc-500">Badges unlock from your score and consistency, with a special reward at 30 days.</p>{challenge.badge && <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-amber-200">Latest badge: {challenge.badge}</div>}</div></aside>
        </section>
      </>}
    </div>
  );
}
