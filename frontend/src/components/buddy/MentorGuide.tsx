/**
 * What to do, for someone who has just been made a mentor.
 *
 * Being approved and being paired says nothing about how to mentor, and the
 * first week of a pairing is when it most often quietly dies. This is shown
 * until the mentor completes their first session, at which point the record
 * card replaces it — so it disappears by being acted on rather than dismissed,
 * and nothing has to be stored to remember that they read it.
 */
import { CalendarPlus, MessageSquareText, Star, Target } from "lucide-react";

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Send the first voice note",
    body: "Don't wait to be messaged. A 30-second hello is the difference between a pairing that starts and one that never does.",
  },
  {
    icon: Target,
    title: "Ask what they want to fix",
    body: "Their cycle has a goal set by the teacher, but the thing they're actually worried about is usually more specific. Ask.",
  },
  {
    icon: CalendarPlus,
    title: "Plan a session, not a chat",
    body: "Pick a debate motion or a drill from the catalog and put a time on it. A session you can both prepare for beats twenty messages.",
  },
  {
    icon: Star,
    title: "Be specific, then be kind",
    body: "\"You said 'um' nine times in the second minute\" is worth more than \"that was good\" — but say what worked too, or they stop asking.",
  },
];

export function MentorGuide({ menteeCount }: { menteeCount: number }) {
  return (
    <section className="c-panel p-4 md:p-5 space-y-4">
      <div>
        <span className="c-label text-[var(--c-accent-text)]">
          You're a mentor now
        </span>
        <h2 className="text-[15px] font-semibold text-[var(--c-text)] mt-1.5">
          {menteeCount === 1
            ? "One student is counting on you"
            : `${menteeCount} students are counting on you`}
        </h2>
        <p className="text-[12.5px] text-[var(--c-muted)] mt-1.5 max-w-2xl leading-relaxed">
          You were picked because your own scores hold up. Here's the part the
          scores don't teach — it takes about a week to get a pairing moving.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-3">
            <div className="w-7 h-7 rounded-[4px] bg-[var(--c-raised)] border border-[var(--c-line-strong)] flex items-center justify-center shrink-0">
              <Icon className="w-3.5 h-3.5 text-[var(--c-accent-text)]" />
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-[var(--c-text)]">
                <span className="text-[var(--c-faint)] tabular-nums">{index + 1}. </span>
                {title}
              </p>
              <p className="text-[11.5px] text-[var(--c-faint)] mt-0.5 leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-[var(--c-faint)]">
        This disappears once you've run your first session.
      </p>
    </section>
  );
}
