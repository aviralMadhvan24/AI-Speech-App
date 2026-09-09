/**
 * One nudge, and the vocabulary every nudge is described in.
 *
 * Shared because the same derived states are shown to two different readers:
 * a teacher works the whole chase list in `DigestPanel`, and a student sees
 * only their own share of it on the buddy screen. Those are the same sentence
 * pointed at different people, so they must not drift apart — a pairing called
 * "stalled" to a teacher cannot be called something else to the two students
 * in it.
 */
import type { Nudge } from "../../buddyApi";
import { personLabel } from "../../buddyApi";
import type { Tone } from "../console/Console";

export const STATE_TONE: Record<string, Tone> = {
  stalled: "neg",
  quiet: "warn",
  not_started: "info",
  no_cycle: "neutral",
  overdue: "warn",
};

export const STATE_LABEL: Record<string, string> = {
  stalled: "Stalled",
  quiet: "Quiet",
  not_started: "Not started",
  no_cycle: "No cycle",
  overdue: "Cycle overdue",
};

export const ROLE_LABEL: Record<string, string> = {
  mentor: "Mentor",
  mentee: "Mentee",
  teacher: "You",
};

/**
 * The message, then the evidence behind it.
 *
 * The second line is not decoration: "pick this back up" is easy to dismiss,
 * and "silent 12 days, 3 sessions kept before it stopped" is the part that
 * says this pairing was working and then stopped, which is a different thing
 * from one that never started.
 */
export function NudgeDetail({ nudge }: { nudge: Nudge }) {
  return (
    <>
      <p className="text-[12px] text-[var(--c-muted)] leading-relaxed">
        {nudge.message}
      </p>
      <p className="text-[11px] text-[var(--c-faint)] mt-0.5 tabular-nums">
        {nudge.partner ? `with ${personLabel(nudge.partner)} · ` : ""}
        {STATE_LABEL[nudge.state] ?? nudge.state}
        {nudge.days_overdue !== null && ` · ${nudge.days_overdue}d past its end date`}
        {nudge.days_quiet !== null && ` · silent ${nudge.days_quiet}d`}
        {nudge.sessions_kept > 0 &&
          ` · ${nudge.sessions_kept} session${
            nudge.sessions_kept === 1 ? "" : "s"
          } kept before it stopped`}
      </p>
    </>
  );
}
