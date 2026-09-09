/**
 * The chase list: who needs hearing from, most urgent first.
 *
 * The nudge in a student's inbox only reaches whoever opens the buddy tab, and
 * the pairings that need chasing are the ones nobody is opening. This is the
 * same information pointed at the person who can go and find them.
 *
 * Grouped by person rather than by pairing on purpose. A teacher works this
 * list by walking up to someone, and a mentor holding three silent pairings is
 * one conversation, not three.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchDigest, personLabel, type BuddyDigest, type Nudge } from "../../buddyApi";
import { Button, Dot, Empty, Panel, Tag } from "../console/Console";
import { NudgeDetail, ROLE_LABEL, STATE_LABEL, STATE_TONE } from "./NudgeList";

function groupByPerson(nudges: Nudge[]) {
  const groups = new Map<string, Nudge[]>();
  for (const nudge of nudges) {
    const key = nudge.user_id;
    const existing = groups.get(key);
    if (existing) existing.push(nudge);
    else groups.set(key, [nudge]);
  }
  // The list is already ordered by urgency, so the first entry for a person
  // carries their most urgent item and the map preserves that order.
  return [...groups.entries()];
}

export function DigestPanel() {
  const [digest, setDigest] = useState<BuddyDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    fetchDigest()
      .then(setDigest)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  useEffect(load, []);

  const groups = useMemo(
    () => (digest ? groupByPerson(digest.nudges) : []),
    [digest],
  );

  if (error) {
    return (
      <Panel title="Needs chasing">
        <Empty>Could not load the digest. {error}</Empty>
      </Panel>
    );
  }

  if (!digest) {
    return (
      <Panel title="Needs chasing">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  const { counts } = digest;

  return (
    <Panel
      title="Needs chasing"
      subtitle={
        digest.total === 0
          ? "Nothing outstanding"
          : `${groups.length} ${groups.length === 1 ? "person" : "people"}, ${digest.total} ${
              digest.total === 1 ? "nudge" : "nudges"
            }`
      }
      actions={
        <Button variant="quiet" onClick={load} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
      }
      flush
    >
      {digest.total === 0 ? (
        <Empty>
          Every active pairing has a cycle and has been heard from. Nothing to do.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 border-b border-[var(--c-line)]">
            {(
              [
                ["stalled", counts.stalled],
                ["quiet", counts.quiet],
                ["not_started", counts.not_started],
                ["no_cycle", counts.no_cycle],
                ["overdue", counts.overdue],
              ] as const
            )
              .filter(([, n]) => n > 0)
              .map(([state, n]) => (
                <Tag key={state} tone={STATE_TONE[state]}>
                  {n} {STATE_LABEL[state]}
                </Tag>
              ))}
            {digest.open_concerns > 0 && (
              <Tag
                tone="neg"
                title="Somebody has already reported a problem — read those before chasing"
              >
                {digest.open_concerns} reported
              </Tag>
            )}
          </div>

          <ul>
            {groups.map(([userId, items]) => (
              <li
                key={userId}
                className="px-3.5 py-2.5 border-b border-[var(--c-line)] last:border-b-0"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Dot tone={STATE_TONE[items[0].state] ?? "neutral"} />
                  <span className="text-[12.5px] font-semibold text-[var(--c-text)] truncate">
                    {personLabel(items[0].person)}
                  </span>
                  <Tag tone="neutral">{ROLE_LABEL[items[0].role] ?? items[0].role}</Tag>
                  {items.length > 1 && (
                    <span className="text-[11px] text-[var(--c-faint)] tabular-nums">
                      {items.length} pairings
                    </span>
                  )}
                </div>

                <ul className="space-y-1.5 pl-4">
                  {items.map((nudge) => (
                    <li key={`${nudge.pair_id}-${nudge.role}`}>
                      <NudgeDetail nudge={nudge} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
