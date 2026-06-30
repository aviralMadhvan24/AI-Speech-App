import { Crown, Home, RotateCcw, Trophy, User } from "lucide-react";
import type { PlayerRole, PlayerScore, RoomState } from "../battleApi";
import { StarRow } from "./StarRow";

interface BattleResultViewProps {
  state: RoomState;
  youAre: PlayerRole;
  onPlayAgain: () => void;
  onHome: () => void;
}

function ScoreLine({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono tabular-nums font-semibold text-zinc-200">
        {value}
        {suffix ? <span className="text-zinc-500 ml-0.5">{suffix}</span> : null}
      </span>
    </div>
  );
}

function PlayerScoreCard({
  name,
  isHost,
  isYou,
  score,
  stars,
  isWinner,
}: {
  name: string;
  isHost: boolean;
  isYou: boolean;
  score: PlayerScore | null;
  stars: number;
  isWinner: boolean;
}) {
  return (
    <div
      className={[
        "card-glass p-5 flex flex-col gap-4",
        isWinner ? "ring-1 ring-amber-400/50 shadow-[0_0_24px_-6px_rgba(251,191,36,0.35)]" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <div
          className={[
            "w-10 h-10 rounded-full flex items-center justify-center",
            isHost ? "bg-amber-500/15 text-amber-300" : "bg-cyan-500/15 text-cyan-300",
          ].join(" ")}
        >
          {isHost ? <Crown className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-zinc-100 truncate">{name}</span>
            {isYou && (
              <span className="text-[10px] uppercase tracking-widest text-brand-300 font-semibold">
                You
              </span>
            )}
            {isWinner && (
              <span className="chip bg-amber-500/15 text-amber-300 border border-amber-500/40">
                <Trophy className="w-3 h-3" />
                Winner
              </span>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            {isHost ? "Host" : "Opponent"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-zinc-100 leading-none">
            {stars}
            <span className="text-zinc-500 text-base font-normal">/3</span>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mt-1">
            Stars
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <ScoreLine
          label="Pronunciation"
          value={score ? Math.round(score.pronunciation_score) : "—"}
        />
        <ScoreLine
          label="Clarity"
          value={score ? Math.round(score.clarity_score) : "—"}
        />
        <ScoreLine
          label="Pace"
          value={score ? Math.round(score.pace_wpm) : "—"}
          suffix="wpm"
        />
      </div>
    </div>
  );
}

function bannerCopy(verdict: RoomState["verdict"], youAre: PlayerRole) {
  if (!verdict) return { title: "Round Complete", tone: "neutral" as const };
  if (verdict.winner === "draw") return { title: "It's a Draw", tone: "neutral" as const };
  if (verdict.winner === youAre) return { title: "You Win", tone: "win" as const };
  return { title: "Opponent Wins", tone: "loss" as const };
}

export function BattleResultView({
  state,
  youAre,
  onPlayAgain,
  onHome,
}: BattleResultViewProps) {
  const { verdict } = state;
  const hostScore = state.scores?.host ?? null;
  const oppScore = state.scores?.opponent ?? null;
  const banner = bannerCopy(verdict, youAre);

  const toneClasses = {
    win: "from-emerald-400 via-emerald-300 to-emerald-200",
    loss: "from-rose-400 via-rose-300 to-rose-200",
    neutral: "from-zinc-300 via-zinc-200 to-zinc-100",
  }[banner.tone];

  return (
    <div key="battle-result" className="animate-fade-in-up space-y-6">
      <section className="card-glass p-8 md:p-10 relative overflow-hidden text-center">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-fuchsia-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-brand-500/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col items-center gap-4">
          <span className="chip bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/30">
            <Trophy className="w-3 h-3" />
            Final Result
          </span>
          <h1
            className={[
              "text-5xl md:text-6xl font-black tracking-tight bg-gradient-to-br bg-clip-text text-transparent",
              toneClasses,
            ].join(" ")}
          >
            {banner.title}
          </h1>
          {verdict && (
            <div className="text-sm text-zinc-400">
              {verdict.host_stars} – {verdict.opponent_stars}{" "}
              <span className="text-zinc-600">stars</span>
            </div>
          )}
        </div>
      </section>

      {verdict && (
        <section className="card-glass p-6 md:p-8">
          <StarRow
            perspective={youAre}
            pronunciation={verdict.pronunciation}
            clarity={verdict.clarity}
            pace={verdict.pace}
          />
        </section>
      )}

      <section className="grid md:grid-cols-2 gap-4">
        <PlayerScoreCard
          name={state.host_name}
          isHost
          isYou={youAre === "host"}
          score={hostScore}
          stars={verdict?.host_stars ?? 0}
          isWinner={verdict?.winner === "host"}
        />
        <PlayerScoreCard
          name={state.opponent_name ?? "Opponent"}
          isHost={false}
          isYou={youAre === "opponent"}
          score={oppScore}
          stars={verdict?.opponent_stars ?? 0}
          isWinner={verdict?.winner === "opponent"}
        />
      </section>

      <section className="flex items-center justify-center gap-3">
        <button type="button" onClick={onPlayAgain} className="btn-primary">
          <RotateCcw className="w-4 h-4" />
          Play Again
        </button>
        <button type="button" onClick={onHome} className="btn-ghost">
          <Home className="w-4 h-4" />
          Home
        </button>
      </section>
    </div>
  );
}
