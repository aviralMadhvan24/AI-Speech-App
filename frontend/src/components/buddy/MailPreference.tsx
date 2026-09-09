/**
 * "Email me when a pairing needs attention."
 *
 * The digest leaves the app, so it has to be refusable from inside it too —
 * the link in the mail covers the person who has just been emailed, and this
 * covers the person deciding before the next one goes out.
 *
 * Stated as a positive ("email me") though the server stores the negative
 * ("opted out"): a checkbox you tick to receive something is the one people
 * read correctly, and inverting once here is cheaper than storing a row for
 * every person who never had an opinion.
 */
import { useEffect, useState } from "react";
import { fetchMailPreference, setMailPreference } from "../../buddyApi";

export function MailPreference() {
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMailPreference()
      .then((pref) => alive && setOptedOut(pref.digest_opted_out))
      // Unknown means no control, rather than a control that lies about the
      // current setting and silently changes it when clicked.
      .catch(() => alive && setOptedOut(null));
    return () => {
      alive = false;
    };
  }, []);

  if (optedOut === null) return null;

  const toggle = () => {
    const next = !optedOut;
    // Move immediately and put it back if the write fails: this is a checkbox,
    // and a checkbox that waits for a round trip feels broken.
    setOptedOut(next);
    setBusy(true);
    setError(null);
    setMailPreference(next)
      .then((pref) => setOptedOut(pref.digest_opted_out))
      .catch((err: unknown) => {
        setOptedOut(!next);
        setError(err instanceof Error ? err.message : "Could not save that.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="px-3.5 py-2.5">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={!optedOut}
          disabled={busy}
          onChange={toggle}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="text-[12.5px] text-[var(--c-text)]">
            Email me when a pairing needs attention
          </span>
          <span className="block text-[11px] text-[var(--c-faint)] mt-0.5">
            At most one message a day, and only about your own pairings. This
            changes the email only — your pairing and everything in the app stay
            exactly as they are.
          </span>
          {error && (
            <span className="block text-[11px] text-[var(--c-neg)] mt-1">
              {error}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
