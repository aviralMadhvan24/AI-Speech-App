// WPM zone helpers ported from speedometer/src/utils/zones.js.
// Ideal speaking pace is 120-160 wpm.

export const MAX_WPM = 260;

export interface ZoneArc {
  from: number;
  to: number;
  color: string;
}

export const ZONE_ARCS: ZoneArc[] = [
  { from: 0, to: 80, color: "#f43f5e" }, // rose-500
  { from: 80, to: 120, color: "#f59e0b" }, // amber-500
  { from: 120, to: 160, color: "#10b981" }, // emerald-500
  { from: 160, to: 200, color: "#f59e0b" }, // amber-500
  { from: 200, to: 260, color: "#f43f5e" }, // rose-500
];

export function getZoneColor(wpm: number): string {
  if (wpm >= 120 && wpm <= 160) return "#10b981";
  if ((wpm >= 80 && wpm < 120) || (wpm > 160 && wpm <= 200)) return "#f59e0b";
  if (wpm === 0) return "#71717a"; // zinc-500
  return "#f43f5e";
}

export interface ZoneInfo {
  text: string;
  className: string;
}

export function getZone(wpm: number): ZoneInfo {
  if (wpm === 0) return { text: "Ready", className: "text-zinc-400" };
  if (wpm >= 120 && wpm <= 160) {
    return { text: "✓ Perfect Pace", className: "text-emerald-300" };
  }
  if (wpm >= 80 && wpm < 120) {
    return { text: "↑ A Bit Slow", className: "text-amber-300" };
  }
  if (wpm > 160 && wpm <= 200) {
    return { text: "↓ A Bit Fast", className: "text-amber-300" };
  }
  if (wpm < 80) return { text: "⚠ Too Slow", className: "text-rose-300" };
  return { text: "⚠ Too Fast", className: "text-rose-300" };
}

export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}
