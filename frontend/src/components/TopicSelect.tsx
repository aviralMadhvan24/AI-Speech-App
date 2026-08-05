import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Dices } from "lucide-react";

/**
 * Accessible dark-theme replacement for a native `<select>`.
 *
 * A native select renders its option list through the OS, which ignores our
 * styling and shows a light-grey popup on the dark lobby. This implements the
 * button + listbox pattern instead: full keyboard support (arrows, Home/End,
 * Enter/Space, Escape, typeahead), `aria-activedescendant`, and click-outside
 * dismissal.
 *
 * The list is rendered through a portal with fixed positioning because the
 * surrounding `.card-glass` sets `overflow: hidden`, which clipped the popup at
 * the card's edge. It also flips above the trigger when there is more room
 * there, so a long list stays fully visible near the bottom of the viewport.
 */

export interface TopicSelectOption {
  id: string;
  title: string;
  text?: string;
  category?: string | null;
}

interface TopicSelectProps {
  label: string;
  options: TopicSelectOption[];
  /** Selected option id, or null for the "random" choice. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Copy for the entry that leaves the choice up to the server. */
  randomLabel?: string;
  accent?: "violet" | "emerald";
  disabled?: boolean;
  /** Message shown in place of the list when there are no options. */
  emptyLabel?: string;
}

const ACCENT = {
  violet: {
    ring: "focus-visible:ring-violet-500/50",
    border: "border-violet-500/60",
    active: "bg-violet-600/20",
    text: "text-violet-300",
  },
  emerald: {
    ring: "focus-visible:ring-emerald-500/50",
    border: "border-emerald-500/60",
    active: "bg-emerald-600/20",
    text: "text-emerald-300",
  },
} as const;

const MAX_LIST_HEIGHT = 288;
const GAP = 6;

interface PopupPosition {
  left: number;
  width: number;
  top: number;
  maxHeight: number;
}

export function TopicSelect({
  label,
  options,
  value,
  onChange,
  randomLabel = "Random",
  accent = "violet",
  disabled = false,
  emptyLabel = "Nothing available yet",
}: TopicSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeahead = useRef({ query: "", at: 0 });
  const baseId = useId();
  const listId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const theme = ACCENT[accent];

  // Index 0 is always the "random" entry, so option i sits at i + 1.
  const entries = useMemo(
    () => [{ id: null as string | null, title: randomLabel }, ...options],
    [options, randomLabel],
  );

  const selectedIndex = useMemo(
    () => Math.max(0, entries.findIndex((e) => e.id === value)),
    [entries, value],
  );

  const selected = entries[selectedIndex] ?? entries[0];
  const selectedDetail = value ? options.find((o) => o.id === value)?.text : undefined;

  /** Measure the trigger and decide whether to drop down or flip up. */
  const measure = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP * 2;
    const spaceAbove = rect.top - GAP * 2;
    const dropUp = spaceBelow < Math.min(MAX_LIST_HEIGHT, 200) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(MAX_LIST_HEIGHT, dropUp ? spaceAbove : spaceBelow));

    setPosition({
      left: rect.left,
      width: rect.width,
      top: dropUp ? rect.top - GAP - maxHeight : rect.bottom + GAP,
      maxHeight,
    });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    setActiveIndex(selectedIndex);
    measure();
    setOpen(true);
  }, [disabled, selectedIndex, measure]);

  const commit = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (entry === undefined) return;
      onChange(entry.id);
      close();
    },
    [entries, onChange, close],
  );

  // Dismiss on outside interaction. The list lives in a portal, so it is not a
  // DOM descendant of the trigger and has to be checked separately.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Fixed positioning has to be refreshed while the page moves under it.
  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => measure();
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, measure]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        return;
      case "Tab":
        setOpen(false);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(entries.length - 1, i + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(entries.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        return;
      default:
        break;
    }

    // Typeahead: jump to the next entry starting with what was typed.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.query = now - state.at > 700 ? event.key : state.query + event.key;
      state.at = now;
      const needle = state.query.toLowerCase();
      const found = entries.findIndex((e) => e.title.toLowerCase().startsWith(needle));
      if (found >= 0) setActiveIndex(found);
    }
  };

  const list = open && position && (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-labelledby={labelId}
      tabIndex={-1}
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      className="z-50 overflow-y-auto overscroll-contain rounded-lg border border-zinc-700/70 bg-zinc-900 p-1 shadow-2xl shadow-black/60"
    >
      {options.length === 0 && (
        <li className="px-3 py-2 text-xs text-zinc-500">{emptyLabel}</li>
      )}
      {(options.length === 0 ? entries.slice(0, 1) : entries).map((entry, index) => {
        const isSelected = index === selectedIndex;
        const isActive = index === activeIndex;
        const detail = entry.id === null ? null : options.find((o) => o.id === entry.id)?.text;
        return (
          <li
            key={entry.id ?? "__random__"}
            id={`${baseId}-opt-${index}`}
            data-index={index}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => commit(index)}
            className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm ${
              isActive ? theme.active : ""
            } ${isSelected ? "text-zinc-50" : "text-zinc-200"}`}
          >
            <span className="mt-0.5 w-4 shrink-0">
              {isSelected ? (
                <Check className={`h-4 w-4 ${theme.text}`} aria-hidden />
              ) : entry.id === null ? (
                <Dices className="h-4 w-4 text-zinc-500" aria-hidden />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{entry.title}</span>
              {detail && (
                <span className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{detail}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-2">
      <span
        id={labelId}
        className="block text-xs font-medium uppercase tracking-wide text-zinc-400"
      >
        {label}
      </span>

      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-activedescendant={open ? `${baseId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-zinc-900/60 px-3 py-2 text-left text-sm text-zinc-100 transition hover:border-zinc-600 focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${theme.ring} ${
          open ? theme.border : "border-zinc-700/60"
        }`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {selected.id === null && (
            <Dices className={`h-4 w-4 shrink-0 ${theme.text}`} aria-hidden />
          )}
          <span className="truncate">{selected.title}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {selectedDetail && (
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{selectedDetail}</p>
      )}

      {list && createPortal(list, document.body)}
    </div>
  );
}
