/**
 * Primitives for the console design system (see styles/console.css).
 *
 * These exist so the rules in the stylesheet are applied consistently rather
 * than remembered. Every one of them encodes a decision that is easy to get
 * wrong by hand — chiefly the difference between "no data" and "measured, and
 * the answer is zero", which this product has to keep visible in a dozen
 * places and which a bare `{value}` collapses every time.
 */
import type { ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  flush,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip body padding — for panels whose content is a list of `Row`s. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={cx("c-panel", className)}>
      {(title || actions) && (
        <header className="c-panel-head">
          <div className="min-w-0">
            {title && <h2 className="c-title truncate">{title}</h2>}
            {subtitle && (
              <p className="text-[11px] text-[var(--c-faint)] mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="c-panel-body">{children}</div>}
    </section>
  );
}

export function Row({
  children,
  onClick,
  selected,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  const classes = cx(
    "c-row",
    onClick && "c-row-interactive cursor-pointer text-left w-full",
    selected && "c-row-selected",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  ) : (
    <div className={classes}>{children}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="c-empty">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

/**
 * A labelled number.
 *
 * `value` of null renders an em-dash, never a zero. The distinction is
 * load-bearing throughout this app: the backend returns null for a rate over
 * an empty denominator precisely so the UI can say "not known yet" instead of
 * putting a 0% in front of a teacher whose programme has simply not finished
 * a cycle.
 */
export function Stat({
  label,
  value,
  suffix,
  hint,
  tone = "default",
  size = "lg",
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
  hint?: ReactNode;
  tone?: "default" | "pos" | "neg" | "warn" | "accent";
  size?: "lg" | "sm";
}) {
  const empty = value === null || value === undefined || value === "";
  const toneColor =
    tone === "pos"
      ? "var(--c-pos)"
      : tone === "neg"
        ? "var(--c-neg)"
        : tone === "warn"
          ? "var(--c-warn)"
          : tone === "accent"
            ? "var(--c-accent-text)"
            : undefined;

  return (
    <div className="min-w-0">
      <p className="c-label">{label}</p>
      <p
        className={cx(
          "c-figure mt-1.5",
          size === "lg" ? "c-figure-lg" : "c-figure-sm",
          empty && "c-figure-empty",
        )}
        style={empty ? undefined : { color: toneColor }}
      >
        {empty ? "—" : value}
        {!empty && suffix && (
          <span className="text-[0.55em] font-semibold ml-0.5 text-[var(--c-faint)]">
            {suffix}
          </span>
        )}
      </p>
      {hint && (
        <p className="text-[11px] text-[var(--c-faint)] mt-1 leading-snug">{hint}</p>
      )}
    </div>
  );
}

/** A signed change. Renders the sign explicitly — "+4" and "4" are not the same claim. */
export function Delta({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return <span className="text-[var(--c-faint)] tabular-nums">—</span>;
  }
  const tone =
    value > 0 ? "var(--c-pos)" : value < 0 ? "var(--c-neg)" : "var(--c-faint)";
  return (
    <span className="tabular-nums font-semibold" style={{ color: tone }}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "pos" | "neg" | "warn" | "info" | "accent";

export function Tag({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span className={`c-tag c-tag-${tone}`} title={title}>
      {children}
    </span>
  );
}

const DOT_COLOR: Record<Tone, string> = {
  neutral: "var(--c-faint)",
  pos: "var(--c-pos)",
  neg: "var(--c-neg)",
  warn: "var(--c-warn)",
  info: "var(--c-info)",
  accent: "var(--c-accent)",
};

/**
 * A status dot. Always render a text label beside it — colour alone is not a
 * label, and this app is used by whole cohorts.
 */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className="c-dot" style={{ background: DOT_COLOR[tone] }} aria-hidden />;
}

/**
 * A proportion bar.
 *
 * `value` null leaves the track empty AND says so via `aria-valuetext`, so an
 * unmeasured axis is never mistaken for a measured zero.
 */
export function Bar({
  value,
  max = 100,
  tone = "accent",
  label,
}: {
  value: number | null;
  max?: number;
  tone?: "accent" | "pos" | "neg" | "muted";
  label?: string;
}) {
  const pct =
    value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="c-bar"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={value === null ? "not measured" : undefined}
    >
      {value !== null && (
        <div
          className={cx(
            "c-bar-fill",
            tone === "pos" && "c-bar-fill-pos",
            tone === "neg" && "c-bar-fill-neg",
            tone === "muted" && "c-bar-fill-muted",
          )}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "default" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx("c-btn", `c-btn-${variant}`, className)}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="c-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx("c-tab", active === tab.id && "c-tab-active")}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="ml-1.5 tabular-nums text-[var(--c-faint)]">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A definition row — label left, value right. The workhorse of a detail panel. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="c-label">{label}</span>
      <span className="text-[12.5px] text-[var(--c-text)] tabular-nums text-right min-w-0">
        {children}
      </span>
    </div>
  );
}
