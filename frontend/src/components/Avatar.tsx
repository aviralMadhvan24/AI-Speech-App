import type { ReactNode } from "react";

interface AvatarProps {
  /** Profile photo URL. When absent, the fallback (or first initial) shows. */
  src?: string | null;
  /** Used to derive the initial letter and the alt text. */
  name?: string | null;
  /**
   * Sizing + color classes for the circle container, e.g.
   * "w-10 h-10 bg-[var(--raised)] border border-[var(--hairline-strong)] text-white".
   * Keep width/height here so callers control the size.
   */
  className?: string;
  /** Optional custom fallback node (e.g. an icon) shown when there's no photo. */
  fallback?: ReactNode;
}

/**
 * Circular avatar that shows the user's uploaded photo when available and
 * gracefully falls back to their initial (or a custom node) otherwise.
 *
 * The photo is rendered with `object-cover` so it fills the circle without
 * distortion. `onError` clears the broken image so the fallback shows if the
 * URL 404s.
 */
export function Avatar({ src, name, className = "", fallback }: AvatarProps) {
  const initial = name?.trim().charAt(0).toUpperCase() || "U";

  return (
    <div
      className={`rounded-full overflow-hidden flex items-center justify-center shrink-0 ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt={name ? `${name} avatar` : "User avatar"}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Hide the broken image so the container's background/fallback shows.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        (fallback ?? initial)
      )}
    </div>
  );
}
