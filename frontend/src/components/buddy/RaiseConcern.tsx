/**
 * "This pairing isn't working" — from either side, to a teacher only.
 *
 * The copy carries most of the design here. Whether a student uses this at all
 * depends entirely on believing their partner will not see it, so the panel
 * says so plainly and more than once. Anything vaguer ("shared with staff")
 * leaves the reader to guess, and a mentee guessing wrong reports nothing.
 *
 * Deliberately understated: a large red button invites reporting a mentor for
 * a slow week. This is a quiet link that opens a form, which is the weight the
 * action should carry.
 */
import { useEffect, useState } from "react";
import {
  fetchMyConcern,
  raiseConcern,
  type BuddyConcern,
  type ConcernReason,
} from "../../buddyApi";
import { Button, Tag } from "../console/Console";

const REASONS: { id: ConcernReason; label: string; detail: string }[] = [
  {
    id: "unresponsive",
    label: "They don't reply",
    detail: "Messages and voice notes are going unanswered.",
  },
  {
    id: "mismatch",
    label: "Wrong match",
    detail: "We're not a good fit for what I'm trying to work on.",
  },
  {
    id: "schedule",
    label: "Can't find a time",
    detail: "Our timetables don't overlap enough to practise.",
  },
  {
    id: "uncomfortable",
    label: "I'm uncomfortable",
    detail: "Something about how this pairing goes isn't okay.",
  },
  { id: "other", label: "Something else", detail: "" },
];

export function RaiseConcern({ pairId }: { pairId: string }) {
  const [existing, setExisting] = useState<BuddyConcern | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ConcernReason>("unresponsive");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMyConcern(pairId)
      .then((data) => alive && setExisting(data.concern))
      .catch(() => {
        /* Not being able to read your own flag must not break the thread. */
      });
    return () => {
      alive = false;
    };
  }, [pairId]);

  const submit = () => {
    setBusy(true);
    setError(null);
    raiseConcern(pairId, reason, detail.trim())
      .then((concern) => {
        setExisting(concern);
        setOpen(false);
        setDetail("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  if (existing) {
    return (
      <div className="c-well px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Tag tone="info">Reported</Tag>
          <span className="text-[11.5px] text-[var(--c-muted)]">
            Your teacher has this. Your partner cannot see it.
          </span>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11.5px] text-[var(--c-faint)] hover:text-[var(--c-muted)] underline underline-offset-2 transition-colors"
      >
        This pairing isn't working
      </button>
    );
  }

  const chosen = REASONS.find((r) => r.id === reason);

  return (
    <div className="c-well p-3 space-y-2.5">
      <div>
        <p className="c-title">Tell your teacher</p>
        <p className="text-[11.5px] text-[var(--c-muted)] mt-1 leading-relaxed">
          This goes to the teacher who set up the pairing.{" "}
          <span className="text-[var(--c-text)]">
            The person you're paired with will not see it
          </span>{" "}
          — not the reason, not what you write, not that you sent anything.
        </p>
      </div>

      <div className="space-y-1">
        {REASONS.map((option) => (
          <label
            key={option.id}
            className={`flex gap-2.5 items-start px-2.5 py-2 rounded-[4px] cursor-pointer border transition-colors ${
              reason === option.id
                ? "border-[var(--c-accent-line)] bg-[var(--c-accent-wash)]"
                : "border-transparent hover:bg-[var(--c-raised)]"
            }`}
          >
            <input
              type="radio"
              name={`concern-${pairId}`}
              value={option.id}
              checked={reason === option.id}
              onChange={() => setReason(option.id)}
              className="mt-0.5 accent-[var(--c-accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-[var(--c-text)]">
                {option.label}
              </span>
              {option.detail && (
                <span className="block text-[11px] text-[var(--c-faint)] mt-0.5 leading-snug">
                  {option.detail}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div>
        <label className="c-label block mb-1" htmlFor={`concern-detail-${pairId}`}>
          Anything else {chosen?.id === "other" ? "(what happened?)" : "(optional)"}
        </label>
        <textarea
          id={`concern-detail-${pairId}`}
          className="c-textarea"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={1000}
          placeholder="A sentence is enough. It helps your teacher know what to do."
        />
      </div>

      {error && <p className="text-[11.5px] text-[var(--c-neg)]">{error}</p>}

      <div className="flex gap-1.5">
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || (reason === "other" && !detail.trim())}
        >
          {busy ? "Sending…" : "Send to teacher"}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
