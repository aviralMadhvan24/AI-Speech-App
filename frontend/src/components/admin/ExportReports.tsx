import { useState } from "react";
import { Download, FileText, Handshake, Loader2, Users, MessageSquareText, Users2, BarChart3, CalendarCheck } from "lucide-react";
import { useToast } from "../Toast";
import { getCurrentIdToken } from "../../hooks/useAuth";

interface ExportOption {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  icon: typeof FileText;
  color: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: "analytics",
    title: "Analytics Summary",
    description: "Overall platform metrics and key statistics",
    endpoint: "/admin/export/analytics_summary.csv",
    icon: BarChart3,
    color: "text-brand-300 bg-brand-500/10 border-brand-500/30",
  },
  {
    id: "students",
    title: "Students Report",
    description: "All students with submission stats and scores",
    endpoint: "/admin/export/students.csv",
    icon: Users,
    color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
  },
  {
    id: "submissions",
    title: "Interview Submissions",
    description: "All interview submissions with scores",
    endpoint: "/admin/export/submissions.csv",
    icon: FileText,
    color: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  },
  {
    id: "debates",
    title: "Debates Report",
    description: "All completed debates with winners",
    endpoint: "/admin/export/debates.csv",
    icon: MessageSquareText,
    color: "text-violet-300 bg-violet-500/10 border-violet-500/30",
  },
  {
    id: "gd",
    title: "Group Discussions",
    description: "All GD sessions with participant scores",
    endpoint: "/admin/export/gd_sessions.csv",
    icon: Users2,
    color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  },
  {
    id: "buddy_pairs",
    title: "Buddy Pairings",
    description: "Every pairing with its cycle, health, and verdict",
    endpoint: "/admin/export/buddy_pairs.csv",
    icon: Handshake,
    color: "text-teal-300 bg-teal-500/10 border-teal-500/30",
  },
  {
    id: "buddy_sessions",
    title: "Buddy Sessions",
    description: "Every planned session, whether it was kept, and its rating",
    endpoint: "/admin/export/buddy_sessions.csv",
    icon: CalendarCheck,
    color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
  },
];

export function ExportReports() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const toast = useToast();

  const handleDownload = async (option: ExportOption) => {
    setDownloading(option.id);
    try {
      const token = await getCurrentIdToken();
      const response = await fetch(option.endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      
      // Get filename from Content-Disposition or generate
      const disposition = response.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `${option.id}_${Date.now()}.csv`;
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success("Downloaded!", `${filename} saved`);
    } catch (err) {
      toast.error(
        "Download failed",
        err instanceof Error ? err.message : "Please try again",
      );
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">Export Reports</h2>
        <p className="text-sm text-zinc-500">
          Download CSV reports for analysis in Excel or Google Sheets
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {EXPORT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isDownloading = downloading === option.id;
          
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleDownload(option)}
              disabled={!!downloading}
              className={[
                "card-glass p-4 text-left transition-all",
                "hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed",
                "border",
                option.color,
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-900/50 flex items-center justify-center flex-shrink-0">
                  {isDownloading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-zinc-100">{option.title}</h3>
                    {!isDownloading && (
                      <Download className="w-3.5 h-3.5 text-zinc-500" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {option.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
