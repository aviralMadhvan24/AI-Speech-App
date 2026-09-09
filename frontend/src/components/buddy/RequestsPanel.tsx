/**
 * Students who have asked for a mentor, longest wait first.
 *
 * A queue, not a feed: the student who asked three weeks ago is the one who
 * needs answering, and newest-first would bury them under everyone since.
 *
 * Declining is kept as a row rather than deleted, and it is not a rejection of
 * the student — the ordinary case is that there was no free approved mentor
 * this term. The count of those is the honest measure of the programme's
 * reach, and deleting them would make an unserved cohort look like an empty
 * queue.
 */
import { useEffect, useState } from "react";
import {
  declineRequest,
  fetchRequests,
  personIn,
  personLabel,
  type BuddyRequest,
  type People,
} from "../../buddyApi";
import { Button, Empty, Panel, Tag } from "../console/Console";

const FOCUS_LABEL: Record<string, string> = {
  content: "What they say",
  pronunciation: "Clarity",
  live_speaking: "Speaking under pressure",
};

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function RequestRow({
  request,
  people,
  onPair,
  onResolved,
}: {
  request: BuddyRequest;
  people: People;
  /** Hands the student to the pairing form rather than pairing them here. */
  onPair: (userId: string) => void;
  onResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = daysSince(request.created_at);

  const decline = () => {
    setBusy(true);
    setError(null);
    declineRequest(request.request_id, note.trim())
      .then(() => onResolved())
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not close that."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <li className="px-3.5 py-2.5 border-b border-[var(--c-line)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12.5px] font-semibold text-[var(--c-text)]">
              {personLabel(personIn(people, request.user_id))}
            </span>
            {request.focus_area && (
              <Tag tone="info">
                {FOCUS_LABEL[request.focus_area] ?? request.focus_area}
              </Tag>
            )}
            <span
              className={`text-[11px] tabular-nums ${
                waiting >= 7 ? "text-[var(--c-neg)]" : "text-[var(--c-faint)]"
              }`}
            >
              waiting {waiting}d
            </span>
          </div>
          {request.note && (
            <p className="text-[12px] text-[var(--c-muted)] mt-1 leading-relaxed">
              “{request.note}”
            </p>
          )}
        </div>

        {!open && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button variant="primary" onClick={() => onPair(request.user_id)}>
              Pair them
            </Button>
            <Button variant="quiet" onClick={() => setOpen(true)}>
              Decline
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          <label className="c-label block" htmlFor={`req-${request.request_id}`}>
            Why not, for the record
          </label>
          <input
            id={`req-${request.request_id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="No approved mentor free this term"
            className="c-input"
          />
          {error && <p className="text-[12px] text-[var(--c-neg)]">{error}</p>}
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={busy || !note.trim()} onClick={decline}>
              {busy ? "Closing…" : "Decline"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {!note.trim() && (
            <p className="text-[11px] text-[var(--c-faint)]">
              A reason is required — otherwise the row records only that somebody
              clicked.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function RequestsPanel({ onPair }: { onPair: (userId: string) => void }) {
  const [requests, setRequests] = useState<BuddyRequest[]>([]);
  const [people, setPeople] = useState<People>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchRequests()
      .then((data) => {
        setRequests(data.requests);
        setPeople(data.people);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load the queue."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <Panel
      title="Asked for a mentor"
      subtitle={
        requests.length === 0
          ? "Nobody waiting"
          : `${requests.length} waiting, longest first`
      }
      flush
    >
      {error ? (
        <Empty>Could not load the queue. {error}</Empty>
      ) : loading ? (
        <Empty>Loading…</Empty>
      ) : requests.length === 0 ? (
        <Empty>
          Nobody has asked. Most pairings start from the suggestions on the
          Pairings tab rather than from here — a student who needs a mentor
          often will not ask for one.
        </Empty>
      ) : (
        <ul>
          {requests.map((request) => (
            <RequestRow
              key={request.request_id}
              request={request}
              people={people}
              onPair={onPair}
              onResolved={load}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
