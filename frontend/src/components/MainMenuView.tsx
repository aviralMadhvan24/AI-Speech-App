import { useMemo } from "react";
import {
  ArrowRight,
  Briefcase,
  Gauge,
  Mic,
  Sparkles,
  Swords,
} from "lucide-react";
import type { AuthUser } from "../types";

interface MainMenuViewProps {
  user: AuthUser;
  onSelectPronunciation: () => void;
  onSelectBattle: () => void;
  onSelectInterview: () => void;
  onSelectFourth: () => void;
}

type FeatureStatus = "live" | "coming-soon";

interface Feature {
  id: string;
  title: string;
  tagline: string;
  description: string;
  icon: typeof Mic;
  status: FeatureStatus;
  accent: string;
  gradient: string;
  ringGlow: string;
  iconGlow: string;
  onClick: () => void;
  ariaLabel: string;
}

export function MainMenuView({
  user,
  onSelectPronunciation,
  onSelectBattle,
  onSelectInterview,
  onSelectFourth,
}: MainMenuViewProps) {
  const features: Feature[] = useMemo(
    () => [
      {
        id: "pronunciation",
        title: "Pronunciation Drill",
        tagline: "Phase 2 · Live",
        description:
          "Speak any prompt aloud and get word-by-word phoneme feedback, clarity, and pace.",
        icon: Mic,
        status: "live",
        accent: "text-brand-300",
        gradient: "from-brand-600/20 via-brand-500/10 to-transparent",
        ringGlow: "hover:shadow-glow",
        iconGlow:
          "bg-gradient-to-br from-brand-500 to-brand-700 shadow-glow-sm",
        onClick: onSelectPronunciation,
        ariaLabel: "Open pronunciation practice",
      },
      {
        id: "battle",
        title: "1v1 Battle",
        tagline: "Phase 2 · Live",
        description:
          "Challenge a friend over a shared room code. Same prompt, simultaneous recording, stars decide.",
        icon: Swords,
        status: "live",
        accent: "text-fuchsia-300",
        gradient: "from-fuchsia-600/20 via-cyan-500/10 to-transparent",
        ringGlow: "hover:shadow-[0_0_32px_-4px_rgba(217,70,239,0.45)]",
        iconGlow:
          "bg-gradient-to-br from-fuchsia-500 to-cyan-500 shadow-[0_0_18px_-4px_rgba(217,70,239,0.55)]",
        onClick: onSelectBattle,
        ariaLabel: "Open 1v1 battle",
      },
      {
        id: "interview",
        title: "Interview Studio",
        tagline: "Phase 3 · Preview",
        description:
          "Record a video answer. AI scores your body language, a teacher grades your content, results combine.",
        icon: Briefcase,
        status: "live",
        accent: "text-amber-300",
        gradient: "from-amber-500/20 via-orange-600/15 to-transparent",
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(245,158,11,0.45)]",
        iconGlow:
          "bg-gradient-to-br from-amber-500 to-orange-600 shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]",
        onClick: onSelectInterview,
        ariaLabel: "Open interview studio",
      },
      {
        id: "cruise",
        title: "Voice CruiseControl",
        tagline: "Phase 2 · Live",
        description:
          "Read a passage aloud. Watch your live speaking pace move the speedometer — green zone is 120–160 wpm.",
        icon: Gauge,
        status: "live",
        accent: "text-emerald-300",
        gradient: "from-emerald-500/20 via-cyan-500/10 to-transparent",
        ringGlow: "hover:shadow-glow-emerald",
        iconGlow:
          "bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-glow-emerald-sm",
        onClick: onSelectFourth,
        ariaLabel: "Open voice cruise control",
      },
    ],
    [onSelectPronunciation, onSelectBattle, onSelectInterview, onSelectFourth],
  );

  return (
    <div key="main-menu" className="animate-fade-in-up">
      {/* Hero greeting */}
      <section className="card-glass relative overflow-hidden p-6 md:p-10 mb-8">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-gradient-to-br from-brand-600/25 via-fuchsia-600/15 to-transparent blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-gradient-to-tr from-cyan-500/15 to-transparent blur-3xl"
        />

        <div className="relative">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-300 bg-zinc-900/60 border border-zinc-800/70 px-3 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Soft Skills Studio</span>
          </div>
          <h1 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight">
            Welcome back,{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-brand-400 via-fuchsia-400 to-cyan-400 animate-gradient-shift bg-[length:200%_200%]">
              {user.displayName}
            </span>
            .
          </h1>
          <p className="mt-3 text-zinc-400 max-w-2xl text-sm md:text-base leading-relaxed">
            Pick a mode to start. Drill pronunciation solo, battle a friend
            head-to-head, or queue up the coming experiences when they launch.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section
        aria-label="Available experiences"
        className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5"
      >
        {features.map((feature, index) => {
          const Icon = feature.icon;
          const isLive = feature.status === "live";
          return (
            <button
              key={feature.id}
              type="button"
              aria-label={feature.ariaLabel}
              onClick={feature.onClick}
              style={{ animationDelay: `${index * 80}ms` }}
              className={[
                "group text-left card-glass relative overflow-hidden p-6 md:p-7",
                "transition duration-300 ease-out",
                "hover:-translate-y-0.5 active:scale-[0.99]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
                "animate-fade-in-up",
                feature.ringGlow,
              ].join(" ")}
            >
              <div
                aria-hidden
                className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-60 group-hover:opacity-100 transition-opacity`}
              />

              <div className="relative flex items-start gap-4">
                <div
                  className={`shrink-0 w-12 h-12 rounded-2xl ${feature.iconGlow} flex items-center justify-center`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] uppercase tracking-widest font-medium ${feature.accent}`}
                    >
                      {feature.tagline}
                    </span>
                    {!isLive && (
                      <span className="text-[10px] uppercase tracking-widest font-medium bg-zinc-800/80 text-zinc-400 px-1.5 py-0.5 rounded">
                        Soon
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-zinc-50 tracking-tight">
                    {feature.title}
                  </h2>
                  <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>

              <div className="relative mt-5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                  {isLive ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                      </span>
                      <span className="text-emerald-300">Ready to play</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex h-2 w-2 rounded-full bg-zinc-600" />
                      <span className="text-zinc-500">Notify on launch</span>
                    </>
                  )}
                </span>

                <span
                  className={`inline-flex items-center gap-1 text-sm font-medium ${
                    isLive ? "text-zinc-100" : "text-zinc-500"
                  } group-hover:gap-2 transition-all`}
                >
                  {isLive ? "Start" : "Preview"}
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </button>
          );
        })}
      </section>

      <footer className="mt-10 text-center text-xs text-zinc-600">
        Logged in as {user.email}
      </footer>
    </div>
  );
}
