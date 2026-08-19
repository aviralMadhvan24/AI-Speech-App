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
    <section className="card-glass relative overflow-hidden p-5 md:p-6 space-y-4">
      <div
        aria-hidden
        className="absolute -top-20 -right-20 h-44 w-44 rounded-full bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-transparent blur-3xl"
      />
      <div className="relative">
        <span className="text-[10px] uppercase tracking-widest text-emerald-300">
          You're a mentor now
        </span>
        <h2 className="text-xl font-semibold text-zinc-100 mt-1">
          {menteeCount === 1
            ? "One student is counting on you"
            : `${menteeCount} students are counting on you`}
        </h2>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
          You were picked because your own scores hold up. Here's the part the
          scores don't teach — it takes about a week to get a pairing moving.
        </p>
      </div>

      <ol className="relative grid gap-3 sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-zinc-800/80 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-teal-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-200">
                <span className="text-zinc-600 tabular-nums">{index + 1}. </span>
                {title}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="relative text-xs text-zinc-600">
        This disappears once you've run your first session.
      </p>
    </section>
  );
}
