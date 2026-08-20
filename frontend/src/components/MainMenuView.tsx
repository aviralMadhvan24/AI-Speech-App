import { useMemo } from "react";
import {
  ArrowRight,
  Briefcase,
  Handshake,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  Sparkles,
  Swords,
  User,
  Users2,
} from "lucide-react";
import type { AuthUser } from "../types";

interface MainMenuViewProps {
  user: AuthUser;
  /** When true, the teacher-only Admin Panel tile is rendered. */
  showAdmin?: boolean;
  onSelectPronunciation: () => void;
  onSelectBattle: () => void;
  onSelectInterview: () => void;
  onSelectDebate: () => void;
  onSelectGD: () => void;
  onSelectAdmin?: () => void;
  onSelectProfile: () => void;
  onSelectPotd: () => void;
  onSelectBuddy: () => void;
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
  ringGlow: string;
  iconGlow: string;
  onClick: () => void;
  ariaLabel: string;
}

export function MainMenuView({
  user,
  showAdmin = false,
  onSelectPronunciation,
  onSelectBattle,
  onSelectInterview,
  onSelectDebate,
  onSelectGD,
  onSelectAdmin,
  onSelectProfile,
  onSelectPotd,
  onSelectBuddy,
}: MainMenuViewProps) {
  const features: Feature[] = useMemo(
    () => {
      const base: Feature[] = [
        {
          id: "potd",
          title: "Problem of the Day",
          tagline: "Daily · Live",
          description:
            "One randomly selected pronunciation or interview challenge. Build your streak and earn badges.",
          icon: Sparkles,
          status: "live",
          accent: "text-orange-300",
          ringGlow:
            "hover:shadow-[0_0_28px_-4px_rgba(249,115,22,0.45)]",
          iconGlow: "bg-[var(--raised)] border border-[var(--hairline-strong)]",
          onClick: onSelectPotd,
          ariaLabel: "Open problem of the day",
        },
      {
        id: "profile",
        title: "My Profile",
        tagline: "Your Stats",
        description:
          "View your performance history, scores, and progress across all activities.",
        icon: User,
        status: "live",
        accent: "text-violet-300",
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(139,92,246,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)]",
        onClick: onSelectProfile,
        ariaLabel: "Open my profile",
      },
      {
        id: "pronunciation",
        title: "Pronunciation Drill",
        tagline: "Phase 2 · Live",
        description:
          "Speak any prompt aloud and get word-by-word phoneme feedback, clarity, and pace.",
        icon: Mic,
        status: "live",
        accent: "text-brand-300",
        ringGlow: "hover:shadow-glow",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-glow-sm",
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
        ringGlow: "hover:shadow-[0_0_32px_-4px_rgba(217,70,239,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(217,70,239,0.55)]",
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
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(245,158,11,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]",
        onClick: onSelectInterview,
        ariaLabel: "Open interview studio",
      },
      {
        id: "debate",
        title: "Debate",
        tagline: "Phase 4 · Live",
        description:
          "Head-to-head debate with one opponent. One motion, one turn each. AI-scored with teacher override.",
        icon: MessageSquareText,
        status: "live",
        accent: "text-violet-300",
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(139,92,246,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)]",
        onClick: onSelectDebate,
        ariaLabel: "Open debate",
      },
      {
        id: "gd",
        title: "Group Discussion",
        tagline: "Phase 5 · New",
        description:
          "Real GD simulation with push-to-talk. 5-10 people, 15 min discussion, individual rankings.",
        icon: Users2,
        status: "live",
        accent: "text-emerald-300",
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(16,185,129,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)]",
        onClick: onSelectGD,
        ariaLabel: "Open group discussion",
      },
      {
        id: "buddy",
        title: "Speaking Buddy",
        tagline: "Peer · New",
        description:
          "A 1:1 line to a peer mentor, paired by your teacher. Text and voice notes, answered whenever you're both free.",
        icon: Handshake,
        status: "live",
        accent: "text-teal-300",
        ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(45,212,191,0.45)]",
        iconGlow:
          "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(45,212,191,0.55)]",
        onClick: onSelectBuddy,
        ariaLabel: "Open speaking buddy",
      },
    ];

      if (showAdmin && onSelectAdmin) {
        base.push({
          id: "admin",
          title: "Admin Panel",
          tagline: "Teacher · Live",
          description:
            "Review pending submissions, see class analytics, leaderboard.",
          icon: LayoutDashboard,
          status: "live",
          accent: "text-cyan-300",
          ringGlow: "hover:shadow-[0_0_28px_-4px_rgba(34,211,238,0.45)]",
          iconGlow:
            "bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)]",
          onClick: onSelectAdmin,
          ariaLabel: "Open admin panel",
        });
      }

      return base;
    },
    [
      onSelectPronunciation,
      onSelectBattle,
      onSelectInterview,
      onSelectDebate,
      onSelectGD,
      onSelectAdmin,
      onSelectProfile,
      onSelectPotd,
      onSelectBuddy,
      showAdmin,
    ],
  );

  return (
    <div key="main-menu" className="animate-fade-in-up">
      {/* The greeting states who is signed in and what to do. It was a
          bordered plate holding a 48px headline and two blurred colour blobs,
          which is a marketing hero on a screen the user reaches several times
          a day. A rule and two lines of type do the same job without the
          furniture. */}
      <section className="mb-7 pb-5 border-b border-[var(--hairline)]">
        <p className="eyebrow">Soft Skills Studio</p>
        <h1 className="mt-2 text-[22px] md:text-[26px] font-semibold tracking-tight text-graphite-50">
          Welcome back, {user.displayName}
        </h1>
        <p className="mt-1.5 text-[13px] text-graphite-300 max-w-2xl leading-relaxed">
          Pick a mode to start. Drill pronunciation solo, battle a friend
          head-to-head, or queue up the coming experiences when they launch.
        </p>
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
                "group text-left card-glass p-5",
                // Lifting a card 2px on hover and easing it over 300ms is a
                // marketing-site gesture. A border that answers immediately
                // reads as a control.
                "transition-colors duration-100",
                "hover:border-brand-500/40",
                "animate-fade-in-up",
              ].join(" ")}
            >
              <div className="flex items-start gap-3.5">
                <div className="shrink-0 w-9 h-9 rounded-md bg-[var(--raised)] border border-[var(--hairline-strong)] flex items-center justify-center group-hover:border-brand-500/40 transition-colors">
                  <Icon className="w-[18px] h-[18px] text-graphite-200 group-hover:text-brand-400 transition-colors" />
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
                  <h2 className="mt-1 text-[15px] font-semibold text-graphite-50 tracking-tight">
                    {feature.title}
                  </h2>
                  <p className="mt-1 text-[12.5px] text-graphite-300 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                  {isLive ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                      <span className="text-[11.5px] text-graphite-300">Ready</span>
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
