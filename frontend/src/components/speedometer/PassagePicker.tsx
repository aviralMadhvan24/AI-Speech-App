import type { Passage } from "../../data/passages";

interface PassagePickerProps {
  passages: Passage[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function PassagePicker({ passages, selectedIndex, onSelect }: PassagePickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {passages.map((passage, idx) => {
        const active = idx === selectedIndex;
        return (
          <button
            key={passage.title}
            type="button"
            onClick={() => onSelect(idx)}
            aria-pressed={active}
            aria-label={`Select paragraph: ${passage.title}`}
            className={[
              "px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
              active
                ? "bg-brand-600/20 border-brand-500/60 text-brand-200 shadow-glow-sm"
                : "bg-zinc-900/60 border-zinc-800/70 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700",
            ].join(" ")}
          >
            {passage.title}
          </button>
        );
      })}
    </div>
  );
}
