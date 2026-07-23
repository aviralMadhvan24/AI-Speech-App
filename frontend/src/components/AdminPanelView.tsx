import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Download,
  HardDrive,
  LayoutDashboard,
  MessagesSquare,
  Trophy,
  Users,
  Users2,
} from "lucide-react";
import { AdminPendingView } from "./admin/AdminPendingView";
import { AdminStudentsView } from "./admin/AdminStudentsView";
import { AdminAnalyticsView } from "./admin/AdminAnalyticsView";
import { AdminLeaderboardView } from "./admin/AdminLeaderboardView";
import { PendingDebatesList } from "./admin/debates/PendingDebatesList";
import { DebateReviewPanel } from "./admin/debates/DebateReviewPanel";
import { PendingGDList } from "./admin/gd/PendingGDList";
import { GDReviewPanel } from "./admin/gd/GDReviewPanel";
import { ExportReports } from "./admin/ExportReports";
import { StorageStats } from "./admin/StorageStats";

type AdminTab =
  | "pending"
  | "students"
  | "analytics"
  | "leaderboard"
  | "debates"
  | "gd"
  | "exports"
  | "storage";

interface AdminPanelViewProps {
  onBack: () => void;
  onOpenReview: (submissionId: string) => void;
  onOpenStudent: (email: string) => void;
}

const TABS: Array<{
  id: AdminTab;
  label: string;
  icon: typeof ClipboardList;
}> = [
  { id: "pending", label: "Pending", icon: ClipboardList },
  { id: "students", label: "Students", icon: Users },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "debates", label: "Debates", icon: MessagesSquare },
  { id: "gd", label: "Group Discussions", icon: Users2 },
  { id: "exports", label: "Exports", icon: Download },
  { id: "storage", label: "Storage", icon: HardDrive },
];

export function AdminPanelView({
  onBack,
  onOpenReview,
  onOpenStudent,
}: AdminPanelViewProps) {
  const [active, setActive] = useState<AdminTab>("pending");
  const [selectedDebateId, setSelectedDebateId] = useState<string | null>(null);
  const [selectedGDSessionId, setSelectedGDSessionId] = useState<string | null>(null);

  // If viewing a specific debate, show the review panel
  if (selectedDebateId) {
    return (
      <DebateReviewPanel
        debateId={selectedDebateId}
        onBack={() => setSelectedDebateId(null)}
      />
    );
  }

  // If viewing a specific GD session, show the review panel
  if (selectedGDSessionId) {
    return (
      <GDReviewPanel
        sessionId={selectedGDSessionId}
        onBack={() => setSelectedGDSessionId(null)}
      />
    );
  }

  return (
    <div key="admin-panel" className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Back to main menu"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1 rounded-full">
          <LayoutDashboard className="w-3.5 h-3.5" />
          <span>Admin Panel · Live</span>
        </div>
      </div>

      <header className="card-glass relative overflow-hidden p-6 md:p-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-cyan-500/25 via-brand-500/15 to-transparent blur-3xl"
        />
        <div className="relative">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Admin{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-brand-400 to-fuchsia-400 animate-gradient-shift bg-[length:200%_200%]">
              Panel
            </span>
          </h1>
          <p className="mt-2 text-zinc-400 text-sm md:text-base max-w-2xl leading-relaxed">
            Review pending interview submissions, browse the class roster, see
            live analytics, and watch the leaderboard.
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Admin sections"
        className="sticky top-[68px] z-20 -mx-2 px-2 py-2 bg-zinc-950/70 backdrop-blur-xl border-b border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(tab.id)}
              className={[
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
                selected
                  ? "bg-brand-500/15 border border-brand-500/40 text-brand-200 shadow-glow-sm"
                  : "border border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-800",
              ].join(" ")}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        {active === "pending" && (
          <AdminPendingView onOpenReview={onOpenReview} />
        )}
        {active === "students" && (
          <AdminStudentsView onOpenStudent={onOpenStudent} />
        )}
        {active === "analytics" && <AdminAnalyticsView />}
        {active === "leaderboard" && <AdminLeaderboardView />}
        {active === "debates" && <PendingDebatesList onOpenDebate={setSelectedDebateId} />}
        {active === "gd" && (
          <PendingGDList onOpenSession={setSelectedGDSessionId} />
        )}
        {active === "exports" && <ExportReports />}
        {active === "storage" && <StorageStats />}
      </div>
    </div>
  );
}
