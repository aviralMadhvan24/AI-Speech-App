/**
 * The teacher's triage queue for pairings somebody reported as not working.
 *
 * Oldest first, because this is a worklist rather than a feed — the pairing
 * that has been waiting three weeks is the one that needs a teacher, and
 * newest-first would bury it under every fresh flag.
 *
 * Resolving requires a note. "Resolved" with no record of what was done
 * reduces to a teacher having clicked something, which is precisely what the
 * flag existed to replace.
 */
import { useEffect, useState } from "react";
import {
  fetchConcerns,
  resolveConcern,
  type BuddyConcern,
  type ConcernReason,
} from "../../buddyApi";
import { Button, Empty, Panel, Tag, type Tone } from "../console/Console";

const REASON_LABEL: Record<ConcernReason, string> = {
  mismatch: "Wrong match",
  unresponsive: "No replies",
  schedule: "Can't find a time",
  uncomfortable: "Uncomfortable",
  other: "Other",
};

/** `uncomfortable` is the one that should pull a teacher's eye first. */
const REASON_TONE: Record<ConcernReason, Tone> = {
  mismatch: "warn",
  unresponsive: "warn",
  schedule: "info",
  uncomfortable: "neg",
  other: "neutral",
};

function daysSince(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
}

function ConcernRow({
  concern,
  onResolved,
}: {
  concern: BuddyConcern;
  onResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = daysSince(concern.raised_at);

  const submit = () => {
    setBusy(true);
    setError(null);
    resolveConcern(concern.concern_id, note.trim())
      .then(() => onResolved())
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <li className="px-3.5 py-3 border-b border-[var(--c-line)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag tone={REASON_TONE[concern.reason]}>
              {REASON_LABEL[concern.reason]}
            </Tag>
            <Tag tone="neutral">raised by {concern.role}</Tag>
            <span
              className={`text-[11px] tabular-nums ${
                waiting >= 7 ? "text-[var(--c-neg)]" : "text-[var(--c-faint)]"
              }`}
            >
              waiting {waiting}d
            </span>
          </div>
          <p className="text-[12.5px] text-[var(--c-text)] mt-1.5">
            {concern.raised_by}
          </p>
          {concern.detail && (
            <p className="text-[12px] text-[var(--c-muted)] mt-1 leading-relaxed">
              “{concern.detail}”
            </p>
          )}
        </div>
        {!open && (
          <Button variant="default" onClick={() => setOpen(true)}>
            Resolve
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          <label className="c-label block" htmlFor={`res-${concern.concern_id}`}>
            What did you do about it?
          </label>
          <textarea
            id={`res-${concern.concern_id}`}
            className="c-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Re-paired with a different mentor / spoke to both / no action needed because…"
          />
          {error && <p className="text-[11.5px] text-[var(--c-neg)]">{error}</p>}
          <div className="flex gap-1.5">
            <Button variant="primary" onClick={submit} disabled={busy || !note.trim()}>
              {busy ? "Saving…" : "Mark resolved"}
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {!note.trim() && (
            <p className="text-[11px] text-[var(--c-faint)]">
              A note is required — otherwise "resolved" records nothing.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ConcernsPanel() {
  const [concerns, setConcerns] = useState<BuddyConcern[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchConcerns()
      .then((data) => setConcerns(data.concerns))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <Panel
      title="Reported problems"
      subtitle={
        concerns.length === 0
          ? "Nothing outstanding"
          : `${concerns.length} waiting, oldest first`
      }
      flush
    >
      {error ? (
        <Empty>Could not load the queue. {error}</Empty>
      ) : loading ? (
        <Empty>Loading…</Empty>
      ) : concerns.length === 0 ? (
        <Empty>
          Nobody has reported a pairing as not working. This is separate from a
          pairing going quiet — check the chase list for those.
        </Empty>
      ) : (
        <ul>
          {concerns.map((concern) => (
            <ConcernRow
              key={concern.concern_id}
              concern={concern}
              onResolved={load}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
