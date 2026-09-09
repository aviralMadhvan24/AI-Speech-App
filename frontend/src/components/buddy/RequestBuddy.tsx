/**
 * "I'd like a mentor" — the one part of this programme a student starts.
 *
 * Everything else here is teacher-push, and that is the right default: the
 * student who most needs coaching is often the last to ask. But it left no way
 * in at all for the student who *does* ask. Their only route was to be
 * noticed, and the ranking that does the noticing is built from scored work —
 * so a student who has done little is invisible to exactly the mechanism meant
 * to help them do more.
 *
 * The note is optional on purpose. Requiring somebody to articulate their own
 * weakness before they may ask for help is a bar placed in front of the exact
 * people this exists for.
 */
import { useEffect, useState } from "react";
import {
  fetchMyRequest,
  requestBuddy,
  type BuddyRequest,
  type RequestBlockedReason,
} from "../../buddyApi";
import { Button, Empty, Panel, Tag } from "../console/Console";

/**
 * Why the button is not there. Stated rather than implied: a disabled control
 * with no explanation reads as the feature being broken.
 */
const BLOCKED: Record<RequestBlockedReason, string> = {
  teacher: "Mentors are for students — you assign them from the admin panel.",
  already_requested: "You have already asked. A teacher will pair you.",
  already_paired:
    "You already have a mentor. If that pairing isn't working, say so from the conversation rather than asking for a second one.",
};

const FOCUS_AREAS = [
  { id: "content", label: "What I say" },
  { id: "pronunciation", label: "How clearly I say it" },
  { id: "live_speaking", label: "Speaking under pressure" },
];

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export function RequestBuddy({ onRequested }: { onRequested?: () => void }) {
  const [pending, setPending] = useState<BuddyRequest | null>(null);
  const [canRequest, setCanRequest] = useState(false);
  const [reason, setReason] = useState<RequestBlockedReason | null>(null);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [focusArea, setFocusArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMyRequest()
      .then((data) => {
        if (!alive) return;
        setPending(data.request);
        setCanRequest(data.can_request);
        setReason(data.reason);
      })
      .catch(() => {
        /* Failing to read your own request must not blank the screen. */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;

  // Nothing to offer: a teacher, or a read that failed. Say what the programme
  // does anyway, because the alternative is a blank screen that looks broken.
  if (!canRequest && !pending) {
    return (
      <Panel
        title="No buddy yet"
        subtitle={reason === "teacher" ? "You assign these" : undefined}
      >
        <Empty>
          {reason === "teacher"
            ? BLOCKED.teacher
            : "Your teacher pairs strong speakers with students who want practice. Keep submitting interviews — that's what the pairing draws on."}
        </Empty>
      </Panel>
    );
  }

  if (pending) {
    const waiting = daysSince(pending.created_at);
    return (
      <Panel title="You asked for a mentor" subtitle="Waiting for a teacher">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Tag tone="info">Asked</Tag>
            <span className="text-[11px] text-[var(--c-faint)] tabular-nums">
              {waiting === 0 ? "today" : `${waiting}d ago`}
            </span>
          </div>
          {pending.note && (
            <p className="text-[12px] text-[var(--c-muted)] leading-relaxed">
              “{pending.note}”
            </p>
          )}
          <p className="text-[11px] text-[var(--c-faint)]">
            {BLOCKED.already_requested}
          </p>
        </div>
      </Panel>
    );
  }

  if (!open) {
    return (
      <Panel
        title="No buddy yet"
        subtitle="Mentors are usually assigned — but you can ask"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Ask for a mentor
          </Button>
        }
      >
        <Empty>
          Your teacher pairs students with peer mentors who already speak well.
          If you would rather not wait to be noticed, ask.
        </Empty>
      </Panel>
    );
  }

  const submit = () => {
    setBusy(true);
    setError(null);
    requestBuddy(note.trim(), focusArea || null)
      .then((created) => {
        setPending(created);
        setOpen(false);
        onRequested?.();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not send that."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Panel title="Ask for a mentor" subtitle="A teacher reads this and pairs you">
      <div className="space-y-3">
        <label className="space-y-1.5 block">
          <span className="c-label">What would you most like to work on?</span>
          <select
            value={focusArea}
            onChange={(event) => setFocusArea(event.target.value)}
            className="c-select"
          >
            <option value="">No preference</option>
            {FOCUS_AREAS.map((area) => (
              <option key={area.id} value={area.id}>
                {area.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 block">
          <span className="c-label">
            Anything else? <span className="text-[var(--c-faint)]">Optional</span>
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="I freeze up when I have to speak without notes."
            className="c-input"
          />
        </label>

        {error && <p className="text-[12px] text-[var(--c-neg)]">{error}</p>}

        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? "Sending…" : "Ask"}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Panel>
  );
}
