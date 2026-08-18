import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Handshake,
  Link2,
  Loader2,
  Sparkles,
  Unlink,
  UserCheck,
  X,
} from "lucide-react";
import {
  createPair,
  decideMentor,
  endPair,
  fetchMentorCandidates,
  fetchPairs,
  type BuddyPair,
  type MentorCandidatesResponse,
  type SpeakerRanking,
} from "../../buddyApi";

/**
 * Teacher view for the buddy programme.
 *
 * Two decisions live here: which strong speakers become mentors, and who each
 * mentor is paired with. The system only ever suggests — nothing takes effect
 * until a teacher acts.
 */

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-300";
  if (score >= 65) return "text-amber-300";
  return "text-zinc-400";
}

function StatusPill({ status }: { status: SpeakerRanking["status"] }) {
  const styles: Record<string, string> = {
    approved: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    rejected: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    suggested: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    none: "text-zinc-500 bg-zinc-800/60 border-zinc-700",
  };
  const label = status === "none" ? "Undecided" : status;
  return (
    <span
      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0 ${styles[status] ?? styles.none}`}
    >
      {label}
    </span>
  );
}

function SpeakerRow({
  speaker,
  busy,
  onDecide,
}: {
  speaker: SpeakerRanking;
  busy: boolean;
  onDecide: (status: "approved" | "rejected") => void;
}) {
  const signals = [
    speaker.content_avg !== null ? `content ${speaker.content_avg}` : null,
    speaker.pronunciation_avg !== null
      ? `pronunciation ${speaker.pronunciation_avg}`
      : null,
  ].filter(Boolean);

  return (
    <div className="card-glass p-4 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-100 truncate">
            {speaker.name || speaker.email}
          </span>
          <StatusPill status={speaker.status} />
          {speaker.active_mentees > 0 && (
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 shrink-0">
              {speaker.active_mentees} mentee
              {speaker.active_mentees === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 truncate">{speaker.email}</p>
        <p className="text-xs text-zinc-600 mt-1">
          {speaker.sample_size} scored attempt
          {speaker.sample_size === 1 ? "" : "s"}
          {signals.length > 0 && ` · ${signals.join(" · ")}`}
        </p>
      </div>

      <div className="text-right shrink-0">
        <div className={`text-2xl font-bold ${scoreTone(speaker.speaking_score)}`}>
          {speaker.speaking_score}
        </div>
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest">
          Speaking
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onDecide("approved")}
          disabled={busy || speaker.status === "approved"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={() => onDecide("rejected")}
          disabled={busy || speaker.status === "rejected"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

export function AdminBuddiesView() {
  const [candidates, setCandidates] = useState<MentorCandidatesResponse | null>(null);
  const [pairs, setPairs] = useState<BuddyPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [mentorEmail, setMentorEmail] = useState("");
  const [menteeEmail, setMenteeEmail] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [candidateData, pairData] = await Promise.all([
        fetchMentorCandidates(),
        fetchPairs(),
      ]);
      setCandidates(candidateData);
      setPairs(pairData.pairs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the buddy data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDecide = useCallback(
    async (email: string, status: "approved" | "rejected") => {
      setBusyEmail(email);
      setError(null);
      try {
        await decideMentor(email, status);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not record that decision.");
      } finally {
        setBusyEmail(null);
      }
    },
    [load],
  );

  const handleCreatePair = useCallback(async () => {
    const mentor = mentorEmail.trim();
    const mentee = menteeEmail.trim();
    if (!mentor || !mentee) return;

    setPairing(true);
    setPairError(null);
    try {
      await createPair(mentor, mentee);
      setMentorEmail("");
      setMenteeEmail("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // Translate the backend's error codes into something a teacher can act on.
      if (message.includes("mentor_not_approved")) {
        setPairError("That mentor has not been approved yet — approve them above first.");
      } else if (message.includes("pair_already_active")) {
        setPairError("These two are already paired.");
      } else {
        setPairError(message || "Could not create that pairing.");
      }
    } finally {
      setPairing(false);
    }
  }, [load, mentorEmail, menteeEmail]);

  const handleEndPair = useCallback(
    async (pairId: string) => {
      setError(null);
      try {
        await endPair(pairId);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not end that pairing.");
      }
    },
    [load],
  );

  const approvedMentors = useMemo(
    () => (candidates?.ranking ?? []).filter((r) => r.status === "approved"),
    [candidates],
  );

  if (loading) {
    return (
      <div className="card-glass p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-brand-300" />
      </div>
    );
  }

  const suggested = candidates?.suggested ?? [];
  const ranking = candidates?.ranking ?? [];
  const activePairs = pairs.filter((p) => p.status === "active");
  const endedPairs = pairs.filter((p) => p.status !== "active");

  return (
    <div className="space-y-6">
      {error && (
        <div className="card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
          {error}
        </div>
      )}

      {/* --- Mentor approval --- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300" />
            Suggested mentors
          </h2>
          <p className="text-xs text-zinc-500">
            Scoring {candidates?.threshold ?? 0}+ across at least{" "}
            {candidates?.min_sample_size ?? 0} attempts
          </p>
        </div>

        {suggested.length === 0 ? (
          <div className="card-glass p-6 text-sm text-zinc-500 text-center">
            No new suggestions. Students need a consistent record before the
            system puts them forward.
          </div>
        ) : (
          <div className="space-y-2">
            {suggested.map((speaker) => (
              <SpeakerRow
                key={speaker.email}
                speaker={speaker}
                busy={busyEmail === speaker.email}
                onDecide={(status) => void handleDecide(speaker.email, status)}
              />
            ))}
          </div>
        )}

        {ranking.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="btn-ghost text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {showAll
              ? "Hide the full ranking"
              : `Show the full ranking (${ranking.length})`}
          </button>
        )}

        {showAll && (
          <div className="space-y-2">
            {ranking.map((speaker) => (
              <SpeakerRow
                key={speaker.email}
                speaker={speaker}
                busy={busyEmail === speaker.email}
                onDecide={(status) => void handleDecide(speaker.email, status)}
              />
            ))}
          </div>
        )}
      </section>

      {/* --- Pairing --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-cyan-300" />
          Create a pairing
        </h2>

        <div className="card-glass p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Mentor
              </span>
              <input
                list="buddy-approved-mentors"
                value={mentorEmail}
                onChange={(event) => setMentorEmail(event.target.value)}
                placeholder="approved.mentor@example.com"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/60"
              />
              <datalist id="buddy-approved-mentors">
                {approvedMentors.map((mentor) => (
                  <option key={mentor.email} value={mentor.email}>
                    {mentor.name || mentor.email}
                  </option>
                ))}
              </datalist>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Mentee
              </span>
              <input
                value={menteeEmail}
                onChange={(event) => setMenteeEmail(event.target.value)}
                placeholder="student@example.com"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/60"
              />
            </label>
          </div>

          {pairError && <p className="text-sm text-rose-300">{pairError}</p>}
          {approvedMentors.length === 0 && (
            <p className="text-xs text-zinc-500">
              No approved mentors yet — approve one above before pairing.
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleCreatePair()}
            disabled={pairing || !mentorEmail.trim() || !menteeEmail.trim()}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {pairing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Handshake className="w-4 h-4" />
            )}
            Pair them
          </button>
        </div>
      </section>

      {/* --- Existing pairings --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-emerald-300" />
          Pairings
        </h2>

        {pairs.length === 0 ? (
          <div className="card-glass p-6 text-sm text-zinc-500 text-center">
            No pairings yet.
          </div>
        ) : (
          <div className="space-y-2">
            {[...activePairs, ...endedPairs].map((pair) => {
              const ended = pair.status !== "active";
              return (
                <div
                  key={pair.pair_id}
                  className={`card-glass p-4 flex items-center gap-3 flex-wrap ${ended ? "opacity-60" : ""}`}
                >
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-semibold text-emerald-300">
                        {pair.mentor_name || pair.mentor_email}
                      </span>
                      <span className="text-zinc-600">mentors</span>
                      <span className="font-semibold text-violet-300">
                        {pair.mentee_name || pair.mentee_email}
                      </span>
                      {ended && (
                        <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-500">
                          Ended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">
                      {pair.mentor_email} · {pair.mentee_email}
                    </p>
                  </div>

                  {!ended && (
                    <button
                      type="button"
                      onClick={() => void handleEndPair(pair.pair_id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-rose-300 hover:border-rose-500/40 transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      End
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
