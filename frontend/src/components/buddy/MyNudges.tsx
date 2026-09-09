/**
 * The caller's own share of the chase list.
 *
 * The programme has always detected a stalled pairing, but until this the
 * detection went only to a teacher's admin panel — so the two people who could
 * actually restart the pairing were the last to hear about it. And a stalled
 * pairing is precisely one that nobody is opening the app to look at, which is
 * why the nudge has to be the first thing on the screen rather than something
 * found by scrolling.
 *
 * Renders nothing at all when there is nothing to say. A panel that is
 * permanently present teaches people to stop reading it.
 */
import { useEffect, useState } from "react";
import { fetchMyNudges, type Nudge } from "../../buddyApi";
import { Dot, Panel } from "../console/Console";
import { NudgeDetail, STATE_TONE } from "./NudgeList";

export function MyNudges() {
  const [nudges, setNudges] = useState<Nudge[]>([]);

  useEffect(() => {
    fetchMyNudges()
      .then((data) => setNudges(data.nudges))
      // Silent on failure by design: this is an aside on somebody else's
      // screen, and an error box where a nudge would have been is worse than
      // the nudge simply not appearing.
      .catch(() => setNudges([]));
  }, []);

  if (nudges.length === 0) return null;

  return (
    <Panel
      title={nudges.length === 1 ? "Needs you" : `${nudges.length} need you`}
      subtitle="Most urgent first"
      flush
    >
      <ul>
        {nudges.map((nudge) => (
          <li
            key={`${nudge.pair_id}-${nudge.role}`}
            className="px-3.5 py-2.5 border-b border-[var(--c-line)] last:border-b-0"
          >
            <div className="flex items-start gap-2">
              <span className="mt-1.5">
                <Dot tone={STATE_TONE[nudge.state] ?? "neutral"} />
              </span>
              <div className="min-w-0">
                <NudgeDetail nudge={nudge} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
