import { getZone } from "../../utils/paceZones";

interface ZoneIndicatorProps {
  wpm: number;
}

export function ZoneIndicator({ wpm }: ZoneIndicatorProps) {
  const zone = getZone(Math.round(wpm));
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full bg-zinc-900/60 border border-zinc-800/70 px-4 py-2 text-sm font-medium ${zone.className}`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping"
          style={{ backgroundColor: "currentColor" }}
        />
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ backgroundColor: "currentColor" }}
        />
      </span>
      <span className="tracking-wide">{zone.text}</span>
    </div>
  );
}
