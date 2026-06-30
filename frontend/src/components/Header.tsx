import { LogOut, Sparkles } from "lucide-react";
import type { AuthUser } from "../types";

interface HeaderProps {
  user?: AuthUser | null;
  onSignOut?: () => void;
  onLogoClick?: () => void;
}

export function Header({ user, onSignOut, onLogoClick }: HeaderProps) {
  const initials = user
    ? user.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join("") || user.email.slice(0, 2).toUpperCase()
    : "";

  return (
    <header className="sticky top-0 z-30 backdrop-blur-2xl bg-zinc-950/60 border-b border-zinc-800/60">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Go to main menu"
          className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-fuchsia-500 blur-md opacity-60" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-fuchsia-600 flex items-center justify-center shadow-glow-sm">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.4} />
            </div>
          </div>
          <div className="leading-tight text-left">
            <div className="font-bold text-zinc-100 tracking-tight">
              Soft Skills Studio
            </div>
            <div className="text-xs text-zinc-500">
              KIET communication platform
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 rounded-full bg-zinc-900/60 border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-semibold text-white">
                  {initials}
                </div>
                <span className="tracking-wide text-zinc-300 max-w-[200px] truncate">
                  {user.email}
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="btn-ghost inline-flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-zinc-900/60 border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="tracking-wide">Local · Private</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
