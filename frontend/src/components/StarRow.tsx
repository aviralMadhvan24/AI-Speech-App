import { Mic2, Sparkles, Star, Timer } from "lucide-react";
import type { Verdict } from "../battleApi";

interface StarRowProps {
  /** Player perspective: "host" or "opponent". */
  perspective: "host" | "opponent";
  pronunciation: Verdict;
  clarity: Verdict;
  pace: Verdict;
}

interface StarItemProps {
  label: string;
  verdict: Verdict;
  perspective: "host" | "opponent";
  icon: React.ReactNode;
}

function StarItem({ label, verdict, perspective, icon }: StarItemProps) {
  // From this player's perspective: did they win this category?
  let tone: "win" | "loss" | "tie";
  if (verdict === "tie") tone = "tie";
  else if (verdict === perspective) tone = "win";
  else tone = "loss";

  const styles = {
    win: {
      ring: "ring-emerald-400/60",
      bg: "bg-emerald-500/15",
      iconColor: "text-emerald-300",
      labelColor: "text-emerald-300",
      starFill: "text-emerald-300 fill-emerald-300",
      shadow: "shadow-glow-emerald-sm",
    },
    loss: {
      ring: "ring-rose-400/40",
      bg: "bg-rose-500/10",
      iconColor: "text-rose-300/80",
      labelColor: "text-rose-300/80",
      starFill: "text-rose-300/60",
      shadow: "",
    },
    tie: {
      ring: "ring-zinc-500/30",
      bg: "bg-zinc-800/40",
      iconColor: "text-zinc-400",
      labelColor: "text-zinc-400",
      starFill: "text-zinc-400",
      shadow: "",
    },
  }[tone];

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={[
          "relative w-20 h-20 rounded-full flex items-center justify-center",
          "ring-1",
          styles.ring,
          styles.bg,
          styles.shadow,
        ].join(" ")}
      >
        <Star
          className={["w-10 h-10", styles.starFill].join(" ")}
          strokeWidth={1.4}
          fill={tone === "win" ? "currentColor" : "none"}
        />
        <span
          className={[
            "absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-zinc-950 ring-1 ring-zinc-800 flex items-center justify-center",
            styles.iconColor,
          ].join(" ")}
        >
          {icon}
        </span>
      </div>
      <div className="text-center">
        <div className={["text-xs font-semibold uppercase tracking-widest", styles.labelColor].join(" ")}>
          {label}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {tone === "win" ? "You won" : tone === "loss" ? "Opponent won" : "Tie"}
        </div>
      </div>
    </div>
  );
}

export function StarRow({ perspective, pronunciation, clarity, pace }: StarRowProps) {
  return (
    <div className="flex items-start justify-center gap-8 md:gap-12">
      <StarItem
        label="Pronunciation"
        verdict={pronunciation}
        perspective={perspective}
        icon={<Mic2 className="w-3.5 h-3.5" />}
      />
      <StarItem
        label="Clarity"
        verdict={clarity}
        perspective={perspective}
        icon={<Sparkles className="w-3.5 h-3.5" />}
      />
      <StarItem
        label="Pace"
        verdict={pace}
        perspective={perspective}
        icon={<Timer className="w-3.5 h-3.5" />}
      />
    </div>
  );
}
