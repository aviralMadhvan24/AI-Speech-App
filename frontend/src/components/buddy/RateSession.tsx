/**
 * Rating a session, with the reason attached.
 *
 * A bare 2/5 tells a mentor to feel bad and nothing about what to change. The
 * aspect chips are the fix, and they carry praise as well as criticism — a
 * vocabulary of only complaints turns the rating into a report card and mentors
 * stop opening it.
 *
 * The chips shown follow the star count, because the useful question changes
 * with the answer: at four or five stars it is "what worked", at one or two it
 * is "what went wrong". Showing all eight at once asks the mentee to do the
 * sorting, and they will skip it.
 *
 * The panel states that the mentor will see this. That is true — the private
 * channel is `RaiseConcern`, which the mentor never sees — and pretending a
 * 1:1 rating were anonymous would be a lie the reader could disprove.
 */
import { useState } from "react";
import { rateSession, type BuddySession, type RatingAspect } from "../../buddyApi";
import { Button } from "../console/Console";

const POSITIVE: { id: RatingAspect; label: string }[] = [
  { id: "prepared", label: "Came prepared" },
  { id: "specific", label: "Gave specific feedback" },
  { id: "encouraging", label: "Encouraging" },
  { id: "punctual", label: "On time" },
];

const NEGATIVE: { id: RatingAspect; label: string }[] = [
  { id: "unprepared", label: "Wasn't prepared" },
  { id: "vague", label: "Feedback was vague" },
  { id: "harsh", label: "Felt harsh" },
  { id: "no_show", label: "Didn't show up" },
];

export const ASPECT_LABEL: Record<RatingAspect, string> = Object.fromEntries(
  [...POSITIVE, ...NEGATIVE].map((a) => [a.id, a.label]),
) as Record<RatingAspect, string>;

export function RateSession({
  session,
  onRated,
}: {
  session: BuddySession;
  onRated: (updated: BuddySession) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [aspects, setAspects] = useState<RatingAspect[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (aspect: RatingAspect) =>
    setAspects((current) =>
      current.includes(aspect)
        ? current.filter((a) => a !== aspect)
        : [...current, aspect],
    );

  const submit = () => {
    if (rating === null) return;
    setBusy(true);
    setError(null);
    rateSession(session.session_id, rating, aspects, note.trim())
      .then(onRated)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // Below three stars something went wrong; at four or five the useful
  // question is what to keep doing. Three shows both — it is genuinely mixed.
  const choices =
    rating === null
      ? []
      : rating >= 4
        ? POSITIVE
        : rating <= 2
          ? NEGATIVE
          : [...POSITIVE, ...NEGATIVE];

  return (
    <div className="c-well p-3 space-y-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="c-label">How was it?</span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setRating(value);
                setAspects([]);
              }}
              aria-label={`Rate ${value} out of 5`}
              aria-pressed={rating === value}
              className={`w-7 h-7 rounded-[4px] text-[13px] transition-colors ${
                rating !== null && value <= rating
                  ? "text-[var(--c-accent)]"
                  : "text-[var(--c-faint)] hover:text-[var(--c-muted)]"
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      {rating !== null && (
        <>
          <div>
            <p className="c-label mb-1.5">
              {rating >= 4 ? "What worked?" : rating <= 2 ? "What went wrong?" : "What stood out?"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((choice) => {
                const on = aspects.includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => toggle(choice.id)}
                    aria-pressed={on}
                    className={`text-[11.5px] px-2 py-1 rounded-[4px] border transition-colors ${
                      on
                        ? "border-[var(--c-accent-line)] bg-[var(--c-accent-wash)] text-[var(--c-accent-text)]"
                        : "border-[var(--c-line-strong)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </div>

          <textarea
            className="c-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Optional — one line your mentor could act on next time."
          />

          {error && <p className="text-[11.5px] text-[var(--c-neg)]">{error}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="primary" onClick={submit} disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </Button>
            <span className="text-[11px] text-[var(--c-faint)]">
              Your mentor sees this. To tell only your teacher, use “this pairing
              isn't working”.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
