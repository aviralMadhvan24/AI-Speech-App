/**
 * The application header.
 *
 * Was a 40px rounded square filled with an indigo-to-fuchsia gradient, sitting
 * under a second copy of itself blurred at 60% opacity to fake a glow, with a
 * Sparkles icon in the middle — the exact logo a project ends up with when
 * nobody drew one.
 *
 * The replacement is a wordmark. Two letters set in the accent inside a plain
 * bordered square reads as an identity rather than as a placeholder, costs no
 * blur layers, and stays legible at any size. The bar itself is opaque: a
 * translucent blurred header means every line of text scrolling underneath it
 * shows through the product's own name.
 */
import { LogOut } from "lucide-react";
import type { AuthUser } from "../types";
import { Avatar } from "./Avatar";

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
    <header className="sticky top-0 z-30 bg-[#0b0c0d] border-b border-[var(--hairline)]">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Go to main menu"
          className="flex items-center gap-2.5 rounded"
        >
          <span className="w-7 h-7 rounded-[5px] border border-brand-500/45 bg-brand-500/10 flex items-center justify-center">
            <span className="text-[11px] font-bold tracking-tight text-brand-400">
              SS
            </span>
          </span>
          <span className="leading-none text-left">
            <span className="block text-[13px] font-semibold text-graphite-100 tracking-tight">
              Soft Skills Studio
            </span>
            <span className="block eyebrow mt-1">KIET</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="hidden sm:flex items-center gap-2 rounded-md bg-[var(--raised)] border border-[var(--hairline)] pl-1 pr-2.5 py-1">
                <Avatar
                  src={user.avatarUrl}
                  name={user.displayName || user.email}
                  className="w-5 h-5 rounded bg-brand-500/15 text-[9px] font-bold text-brand-300"
                  fallback={initials}
                />
                <span className="text-[11.5px] text-graphite-300 max-w-[190px] truncate">
                  {user.email}
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="btn-ghost px-2.5 py-1.5 text-[11.5px]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            /* A pinging green dot claims something is happening. Nothing is —
               it is a static fact about where the app runs, so it is stated. */
            <span className="flex items-center gap-1.5 rounded-md bg-[var(--raised)] border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-graphite-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
              Local · Private
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
