import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Handshake,
  Link2,
  Loader2,
  Star,
  Unlink,
  UserCheck,
  X,
} from "lucide-react";
import {
  closeCycle,
  createCycle,
  createPair,
  fetchCycles,
  type BuddyCycle,
  decideMentor,
  endPair,
  fetchMentorCandidates,
  fetchPairs,
  fetchStudents,
  personIn,
  personLabel,
  sweepCycles,
  type BuddyPair,
  type CycleVerdict,
  type MentorCandidatesResponse,
  type PairHealth,
  type PairState,
  type People,
  type SpeakerRanking,
  type StudentRow,
  type SuggestedPairing,
} from "../../buddyApi";

/**
 * Teacher view for the buddy programme.
 *
 * Two decisions live here: which strong speakers become mentors, and who each
 * mentor is paired with. The system only ever suggests — nothing takes effect
 * until a teacher acts.
 */

/**
 * How a pairing is going, and what a teacher would do about it.
 *
 * `order` is what the pairings list sorts by: the whole reason to open this
 * page is to find the pairing that has stopped, so it should not be the one
 * you have to scroll to.
 */
const HEALTH: Record<
  PairState,
  { label: string; tone: string; order: number; hint: string }
> = {
  stalled: {
    label: "Stalled",
    tone: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    order: 0,
    hint: "Nothing is happening here — worth a word with both of them.",
  },
  quiet: {
    label: "Quiet",
    tone: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    order: 1,
    hint: "A week without contact.",
  },
  no_cycle: {
    label: "No cycle",
    tone: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    order: 2,
    hint: "Nothing is being tracked until you start one.",
  },
  overdue: {
    label: "Overdue",
    tone: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    order: 2.5,
    hint: "The cycle ran past its end date — close it to record the verdict.",
  },
  not_started: {
    label: "Not started",
    tone: "text-zinc-300 bg-zinc-500/10 border-zinc-600/40",
    order: 3,
    hint: "Cycle is open but they have not spoken yet.",
  },
  on_track: {
    label: "On track",
    tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    order: 4,
    hint: "",
  },
  ended: {
    label: "Ended",
    tone: "text-zinc-500 bg-zinc-800/60 border-zinc-700",
    order: 5,
    hint: "",
  },
};

/**
 * The verdict a cycle closed with. Frozen at close, never recomputed.
 *
 * `not_enough_evidence` is shown as plainly as the rest: a cycle nobody
 * measured is a different outcome from one that held steady, and dressing it
 * up as a flat result is the one thing this must not do.
 */
const VERDICT: Record<CycleVerdict, { label: string; tone: string }> = {
  improved: { label: "Improved", tone: "text-emerald-300" },
  held: { label: "Held steady", tone: "text-sky-300" },
  declined: { label: "Declined", tone: "text-amber-300" },
  not_enough_evidence: { label: "Nothing measured", tone: "text-zinc-500" },
};

function ClosedCycleLine({ cycle }: { cycle: BuddyCycle }) {
  const closed = cycle.closed_at
    ? new Date(cycle.closed_at).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    : null;

  if (!cycle.summary) {
    // A close whose reporting failed — never blocked, and never invented.
    return (
      <p className="text-xs text-zinc-600 mt-1.5">
        Last cycle closed{closed ? ` ${closed}` : ""} without a summary.
      </p>
    );
  }

  const verdict = VERDICT[cycle.summary.verdict] ?? VERDICT.not_enough_evidence;
  return (
    <p className="text-xs text-zinc-600 mt-1.5">
      Last cycle: <span className={verdict.tone}>{verdict.label}</span> ·{" "}
      {cycle.summary.sessions_completed} session
      {cycle.summary.sessions_completed === 1 ? "" : "s"} kept
      {closed ? ` · closed ${closed}` : ""}
    </p>
  );
}

/** The activity line under a pairing: what happened, not how it scored. */
function HealthLine({ health }: { health: PairHealth }) {
  const { sessions, days_quiet: daysQuiet } = health;
  const parts: string[] = [];

  if (sessions.completed > 0) {
    parts.push(`${sessions.completed} session${sessions.completed === 1 ? "" : "s"} kept`);
  }
  if (sessions.missed > 0) parts.push(`${sessions.missed} missed`);
  if (sessions.planned > 0) parts.push(`${sessions.planned} planned`);
  if (health.message_count > 0) {
    parts.push(
      `${health.message_count} message${health.message_count === 1 ? "" : "s"}`,
    );
  }
  // Only worth saying once it means something — "quiet for 0 days" is noise.
  if (daysQuiet !== null && daysQuiet >= 2 && health.state !== "ended") {
    parts.push(
      health.last_activity_at
        ? `quiet ${daysQuiet} days`
        : `${daysQuiet} days with nothing`,
    );
  }

  const hint = HEALTH[health.state].hint;
  if (parts.length === 0 && !hint) return null;

  return (
    <p className="text-xs text-zinc-500 mt-1.5">
      {parts.join(" · ")}
      {parts.length > 0 && hint ? " — " : ""}
      {hint}
    </p>
  );
}

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
  // Every axis the ranking could attribute. A strong debater with no
  // interviews used to show nothing here at all.
  const signals = [
    speaker.content_avg !== null ? `content ${speaker.content_avg}` : null,
    speaker.pronunciation_avg !== null
      ? `pronunciation ${speaker.pronunciation_avg}`
      : null,
    speaker.live_speaking_avg !== null
      ? `debates & GD ${speaker.live_speaking_avg}`
      : null,
  ].filter(Boolean);

  return (
    <div className="c-panel p-3.5 flex items-center gap-3 flex-wrap">
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
          {speaker.sample_size} piece{speaker.sample_size === 1 ? "" : "s"} of
          scored work
          {signals.length > 0 && ` · ${signals.join(" · ")}`}
        </p>
        {/* Being a strong speaker and being a good mentor are different
            things, and only this line is evidence of the second. */}
        {speaker.sessions_mentored > 0 && (
          <p className="text-xs text-amber-300/90 mt-1 inline-flex items-center gap-1.5">
            <Star className="w-3 h-3 shrink-0" />
            {speaker.mentor_rating !== null
              ? `Rated ${speaker.mentor_rating.toFixed(1)} by their mentees`
              : "Not yet rated by their mentees"}
            <span className="text-zinc-600">
              · {speaker.sessions_mentored} session
              {speaker.sessions_mentored === 1 ? "" : "s"} run
            </span>
          </p>
        )}
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

import { Button, Panel, Tabs, Tag } from "../console/Console";
import { ConcernsPanel } from "../buddy/ConcernsPanel";
import { DigestPanel } from "../buddy/DigestPanel";
import { MentorCandidates } from "../buddy/MentorCandidates";
import { ProgrammePanel } from "../buddy/ProgrammePanel";
import { RequestsPanel } from "../buddy/RequestsPanel";

type AdminTab =
  | "programme"
  | "chase"
  | "reported"
  | "requests"
  | "mentors"
  | "pairings";

export function AdminBuddiesView() {
  const [tab, setTab] = useState<AdminTab>("programme");
  const [openConcerns, setOpenConcerns] = useState<Record<string, number>>({});
  const [candidates, setCandidates] = useState<MentorCandidatesResponse | null>(null);
  const [pairs, setPairs] = useState<BuddyPair[]>([]);
  // Pairs store ids only, so the names on this screen come from here.
  const [people, setPeople] = useState<People>({});
  // The cohort, for the two pairing dropdowns. An id cannot be typed, so the
  // list of students *is* the input — which also means a teacher can finally
  // see who has no mentor rather than only pairing people they thought of.
  const [students, setStudents] = useState<StudentRow[]>([]);
  // Suggested, never applied: clicking one fills the form, it does not pair.
  const [suggestions, setSuggestions] = useState<SuggestedPairing[]>([]);
  const [openRequests, setOpenRequests] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, PairHealth>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [mentorId, setMentorId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [cycleWeeks, setCycleWeeks] = useState(4);
  const [cycleGoal, setCycleGoal] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<BuddyCycle[]>([]);
  const [busyPairId, setBusyPairId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [candidateData, pairData, cycleData, studentData] = await Promise.all([
        fetchMentorCandidates(),
        fetchPairs(),
        fetchCycles(),
        fetchStudents(),
      ]);
      setCandidates(candidateData);
      setPairs(pairData.pairs);
      setPeople(pairData.people ?? {});
      setHealth(pairData.health ?? {});
      setOpenConcerns(pairData.open_concerns ?? {});
      setCycles(cycleData.cycles);
      setStudents(studentData.students);
      setSuggestions(studentData.suggestions);
      // The cohort already knows who is waiting, so the tab count costs no
      // extra request.
      setOpenRequests(
        studentData.students.filter((row) => row.open_request !== null).length,
      );
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
    async (userId: string, status: "approved" | "rejected") => {
      setBusyUserId(userId);
      setError(null);
      try {
        await decideMentor(userId, status);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not record that decision.");
      } finally {
        setBusyUserId(null);
      }
    },
    [load],
  );

  // `ends_at` was written when a cycle opened and then only ever displayed, so
  // a cycle could run past its end indefinitely: the summary was never
  // computed, the verdict never reached the pair, and the `improved` verdict
  // that feeds growth back into mentor selection never fired. This is the one
  // click that clears them.
  const handleSweep = useCallback(async () => {
    setSweeping(true);
    setSweepResult(null);
    setError(null);
    try {
      const { closed, total } = await sweepCycles();
      const verdicts = closed
        .map((cycle) => cycle.summary?.verdict)
        .filter((verdict): verdict is CycleVerdict => Boolean(verdict))
        .map((verdict) => VERDICT[verdict].label);
      setSweepResult(
        total === 0
          ? "Nothing was overdue."
          : `Closed ${total} cycle${total === 1 ? "" : "s"}${
              verdicts.length > 0 ? ` — ${verdicts.join(", ")}` : ""
            }.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close them.");
    } finally {
      setSweeping(false);
    }
  }, [load]);

  const handleCreatePair = useCallback(async () => {
    const mentor = mentorId.trim();
    const mentee = menteeId.trim();
    if (!mentor || !mentee) return;

    setPairing(true);
    setPairError(null);
    try {
      await createPair(mentor, mentee, {
        weeks: cycleWeeks,
        goal: cycleGoal.trim(),
      });
      setMentorId("");
      setMenteeId("");
      setCycleGoal("");
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
  }, [load, mentorId, menteeId, cycleWeeks, cycleGoal]);

  const activeCycleFor = useCallback(
    (pairId: string) =>
      cycles.find((c) => c.pair_id === pairId && c.status === "active") ?? null,
    [cycles],
  );

  // `fetchCycles` returns newest first, so the first match is the last one to
  // have closed — which is the only one whose verdict is still worth showing.
  const lastClosedFor = useCallback(
    (pairId: string) =>
      cycles.find((c) => c.pair_id === pairId && c.status === "closed") ?? null,
    [cycles],
  );

  const handleStartCycle = useCallback(
    async (pairId: string) => {
      setBusyPairId(pairId);
      setError(null);
      try {
        await createCycle(pairId, cycleWeeks, "");
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        setError(
          message.includes("cycle_already_active")
            ? "That pair already has a cycle running — close it before starting another."
            : message || "Could not start that cycle.",
        );
      } finally {
        setBusyPairId(null);
      }
    },
    [cycleWeeks, load],
  );

  const handleCloseCycle = useCallback(
    async (cycleId: string, pairId: string) => {
      setBusyPairId(pairId);
      setError(null);
      try {
        await closeCycle(cycleId);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not close that cycle.");
      } finally {
        setBusyPairId(null);
      }
    },
    [load],
  );

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

  // Least-loaded first: the mentor a teacher should reach for is the one with
  // capacity, not whoever happens to sort first alphabetically.
  const mentorOptions = useMemo(
    () =>
      students
        .filter((row) => row.is_approved_mentor)
        .sort((a, b) => a.active_mentees - b.active_mentees),
    [students],
  );

  // Whoever asked comes first — they are the only students who have said out
  // loud that they want this, and the queue is worth clearing.
  const menteeOptions = useMemo(
    () =>
      students
        .filter((row) => !row.has_mentor)
        .sort((a, b) => Number(Boolean(b.open_request)) - Number(Boolean(a.open_request))),
    [students],
  );

  if (loading) {
    return (
      <div className="c-panel p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-brand-300" />
      </div>
    );
  }

  const suggested = candidates?.suggested ?? [];
  const ranking = candidates?.ranking ?? [];
  // The pairing that has stopped is the one worth finding, so it sorts first.
  const activePairs = pairs
    .filter((p) => p.status === "active")
    .sort(
      (a, b) =>
        (HEALTH[health[a.pair_id]?.state ?? "on_track"].order) -
        (HEALTH[health[b.pair_id]?.state ?? "on_track"].order),
    );
  const endedPairs = pairs.filter((p) => p.status !== "active");
  const needAttention = activePairs.filter((p) =>
    ["stalled", "quiet"].includes(health[p.pair_id]?.state ?? ""),
  ).length;

  const concernCount = Object.values(openConcerns).reduce((sum, n) => sum + n, 0);
  const unpairedCount = students.filter((row) => !row.has_mentor).length;
  // Read off pair health rather than off `cycles`, so "overdue" means the same
  // thing here as it does in the digest and on the pairing rows.
  const overdueCount = activePairs.filter(
    (p) => health[p.pair_id]?.state === "overdue",
  ).length;

  return (
    <div className="console space-y-3">
      {error && (
        <div className="c-panel px-3.5 py-2.5 text-[12.5px] text-[var(--c-neg)] border-[rgba(201,106,92,0.35)]">
          {error}
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "programme", label: "Programme" },
          { id: "chase", label: "Needs chasing", count: needAttention },
          { id: "reported", label: "Reported", count: concernCount },
          { id: "requests", label: "Asked", count: openRequests },
          { id: "mentors", label: "Mentors", count: suggested.length },
          { id: "pairings", label: "Pairings", count: activePairs.length },
        ]}
      />

      {tab === "programme" && <ProgrammePanel />}
      {tab === "chase" && <DigestPanel />}
      {tab === "reported" && <ConcernsPanel />}

      {/* Pairing happens on the Pairings tab and nowhere else, so answering a
          request hands the student over rather than duplicating the form. */}
      {tab === "requests" && (
        <RequestsPanel
          onPair={(userId) => {
            setMenteeId(userId);
            setTab("pairings");
          }}
        />
      )}

      {tab === "mentors" && (
        <div className="space-y-3">
          <MentorCandidates
            data={candidates}
            busy={busyUserId !== null}
            onDecide={(userId, status) => void handleDecide(userId, status)}
          />

      {/* The full ranking, behind a toggle. Everyone is here including the
          already-decided, which is the reference list rather than the
          worklist — `MentorCandidates` above is the thing to act on. */}
          {ranking.length > 0 && (
            <Panel
              title="Full ranking"
              subtitle={`Every student with scored speaking work (${ranking.length})`}
              actions={
                <Button variant="quiet" onClick={() => setShowAll((c) => !c)}>
                  {showAll ? "Hide" : "Show"}
                </Button>
              }
              flush={showAll}
            >
              {showAll ? (
                <div className="space-y-2 p-3">
                  {ranking.map((speaker) => (
                    <SpeakerRow
                      key={speaker.user_id}
                      speaker={speaker}
                      busy={busyUserId === speaker.user_id}
                      onDecide={(status) => void handleDecide(speaker.user_id, status)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--c-faint)]">
                  Ordered by lifetime average — which is exactly what hides the
                  students who climbed. Use the suggestions above to act.
                </p>
              )}
            </Panel>
          )}
        </div>
      )}

      {tab === "pairings" && (
        <div className="space-y-6">

      {/* --- Suggested pairings ---
          "Who has no mentor" and "who is free to mentor" are two lists a
          teacher has to hold in their head at once, and holding thirty of each
          is what stops anyone being paired at all. Clicking a suggestion fills
          the form below; it never pairs anybody on its own. */}
      {suggestions.length > 0 && (
        <Panel
          title="Suggested pairings"
          subtitle={`${unpairedCount} student${
            unpairedCount === 1 ? "" : "s"
          } have no mentor`}
          flush
        >
          <ul>
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.mentee.user_id}
                className="px-3.5 py-2.5 border-b border-[var(--c-line)] last:border-b-0 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap text-[12.5px]">
                    <span className="font-semibold text-violet-300">
                      {personLabel(suggestion.mentee)}
                    </span>
                    <span className="text-zinc-600">with</span>
                    <span className="font-semibold text-emerald-300">
                      {personLabel(suggestion.mentor)}
                    </span>
                    {suggestion.mentor_active_mentees > 0 && (
                      <Tag tone="neutral">
                        {suggestion.mentor_active_mentees} already
                      </Tag>
                    )}
                  </div>
                  {suggestion.reason && (
                    <p className="text-[11.5px] text-[var(--c-muted)] mt-1 leading-relaxed">
                      {suggestion.reason}
                    </p>
                  )}
                </div>
                <Button
                  variant="default"
                  onClick={() => {
                    setMentorId(suggestion.mentor.user_id);
                    setMenteeId(suggestion.mentee.user_id);
                  }}
                >
                  Use this
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* --- Pairing --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-cyan-300" />
          Create a pairing
        </h2>

        <div className="c-panel p-3.5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Mentor
              </span>
              <select
                value={mentorId}
                onChange={(event) => setMentorId(event.target.value)}
                className="c-select"
              >
                <option value="">Choose an approved mentor…</option>
                {mentorOptions.map((row) => (
                  <option key={row.person.user_id} value={row.person.user_id}>
                    {personLabel(row.person)}
                    {row.active_mentees > 0
                      ? ` · ${row.active_mentees} mentee${
                          row.active_mentees === 1 ? "" : "s"
                        }`
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Mentee
              </span>
              <select
                value={menteeId}
                onChange={(event) => setMenteeId(event.target.value)}
                className="c-select"
              >
                <option value="">Choose a student…</option>
                {/* Students already being mentored are excluded rather than
                    shown and rejected: one mentor at a time is a rule the
                    backend enforces, so offering them is offering a 409. */}
                {menteeOptions.map((row) => (
                  <option key={row.person.user_id} value={row.person.user_id}>
                    {personLabel(row.person)}
                    {row.open_request ? " · asked for a mentor" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Pairing and opening the first cycle are one action for a teacher —
              a pairing with no end date is the gap cycles exist to close. */}
          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3 pt-1 border-t border-zinc-800/60">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Cycle length
              </span>
              <select
                value={cycleWeeks}
                onChange={(event) => setCycleWeeks(Number(event.target.value))}
                className="c-select"
              >
                {[2, 4, 6, 8, 12].map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks} weeks
                  </option>
                ))}
                <option value={0}>No cycle</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest text-zinc-500">
                Goal for this cycle
              </span>
              <input
                value={cycleGoal}
                onChange={(event) => setCycleGoal(event.target.value)}
                placeholder="Speak for two minutes without filler words"
                disabled={cycleWeeks === 0}
                className="c-input"
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
            disabled={pairing || !mentorId || !menteeId}
            className="c-btn c-btn-primary"
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-300" />
            Pairings
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            {needAttention > 0 && (
              <p className="text-xs text-amber-300/90">
                {needAttention} of {activePairs.length} need a look
              </p>
            )}
            {overdueCount > 0 && (
              <Button variant="default" disabled={sweeping} onClick={() => void handleSweep()}>
                {sweeping
                  ? "Closing…"
                  : `Close ${overdueCount} overdue cycle${overdueCount === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </div>
        {sweepResult && (
          <p className="text-xs text-[var(--c-muted)]">{sweepResult}</p>
        )}

        {pairs.length === 0 ? (
          <div className="c-panel c-empty">
            No pairings yet.
          </div>
        ) : (
          <div className="space-y-2">
            {[...activePairs, ...endedPairs].map((pair) => {
              const ended = pair.status !== "active";
              const pairHealth = health[pair.pair_id];
              return (
                <div
                  key={pair.pair_id}
                  className={`c-panel p-3.5 flex items-center gap-3 flex-wrap ${ended ? "opacity-55" : ""}`}
                >
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-semibold text-emerald-300">
                        {personLabel(personIn(people, pair.mentor_id))}
                      </span>
                      <span className="text-zinc-600">mentors</span>
                      <span className="font-semibold text-violet-300">
                        {personLabel(personIn(people, pair.mentee_id))}
                      </span>
                      {pairHealth && (
                        <span
                          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0 ${HEALTH[pairHealth.state].tone}`}
                        >
                          {HEALTH[pairHealth.state].label}
                        </span>
                      )}
                      {/* Separate from health on purpose — health measures
                          activity, and a busy pairing can still be the wrong
                          pairing. See the Reported tab to act on it. */}
                      {(openConcerns[pair.pair_id] ?? 0) > 0 && (
                        <Tag
                          tone="neg"
                          title="Somebody in this pairing reported it as not working"
                        >
                          Reported
                        </Tag>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">
                      {personIn(people, pair.mentor_id).email ?? pair.mentor_id} ·{" "}
                      {personIn(people, pair.mentee_id).email ?? pair.mentee_id}
                    </p>
                    {!ended &&
                      (() => {
                        const cycle = activeCycleFor(pair.pair_id);
                        if (!cycle) return null;
                        return (
                          <p className="text-xs text-teal-300/90 mt-1.5">
                            Cycle ends{" "}
                            {new Date(cycle.ends_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })}
                            {cycle.goal ? ` · ${cycle.goal}` : ""}
                          </p>
                        );
                      })()}
                    {/* The point of closing a cycle is finding out whether it
                        worked, so the answer lives on the row. */}
                    {(() => {
                      const closed = lastClosedFor(pair.pair_id);
                      return closed ? <ClosedCycleLine cycle={closed} /> : null;
                    })()}
                    {pairHealth && !ended && <HealthLine health={pairHealth} />}
                  </div>

                  {!ended &&
                    (() => {
                      const cycle = activeCycleFor(pair.pair_id);
                      const busy = busyPairId === pair.pair_id;
                      return cycle ? (
                        <button
                          type="button"
                          onClick={() => void handleCloseCycle(cycle.cycle_id, pair.pair_id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition shrink-0 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                        >
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Close cycle
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleStartCycle(pair.pair_id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-teal-500/40 text-teal-300 hover:bg-teal-500/10 transition shrink-0 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60"
                        >
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Start cycle
                        </button>
                      );
                    })()}

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
      )}
    </div>
  );
}
