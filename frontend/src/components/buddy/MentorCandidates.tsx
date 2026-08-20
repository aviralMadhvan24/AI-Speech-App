/**
 * Who to approve as a mentor, and why they are being put forward.
 *
 * Two things this has to show that a plain ranked list cannot.
 *
 * First, the basis. `speaking_score` is a LIFETIME mean, so a student who went
 * 45 to 72 still averages the high fifties — on score alone they never appear,
 * and the cohort's naturally strong speakers mentor until they burn out. The
 * growth path puts those students in front of a teacher, and the badge has to
 * say which path someone came in on or the teacher is looking at a low number
 * with no explanation.
 *
 * Second, the climb itself, spelled out as "45 → 72". That is the sentence a
 * teacher can act on; the average is the number that hides it.
 */
import type { MentorCandidatesResponse, SpeakerRanking } from "../../buddyApi";
import { Bar, Button, Empty, Panel, Tag, type Tone } from "../console/Console";

const BASIS_TONE: Record<string, Tone> = {
  growth: "accent",
  score: "info",
  both: "pos",
};

const BASIS_LABEL: Record<string, string> = {
  growth: "Climbed",
  score: "Scores",
  both: "Scores + climbed",
};

function Climb({ candidate }: { candidate: SpeakerRanking }) {
  if (candidate.best_gain === null) return null;
  return (
    <span className="text-[11px] text-[var(--c-faint)] tabular-nums">
      {candidate.grew_from !== null && candidate.grew_to !== null ? (
        <>
          {candidate.grew_from.toFixed(0)} →{" "}
          <span className="text-[var(--c-pos)]">
            {candidate.grew_to.toFixed(0)}
          </span>{" "}
          in a cycle
        </>
      ) : (
        <>+{candidate.best_gain.toFixed(1)} in a cycle</>
      )}
      {candidate.improved_cycles > 1 && ` · ${candidate.improved_cycles} cycles`}
    </span>
  );
}

function CandidateRow({
  candidate,
  onDecide,
  busy,
}: {
  candidate: SpeakerRanking;
  onDecide: (email: string, status: "approved" | "rejected") => void;
  busy: boolean;
}) {
  const basis = candidate.suggestion_basis;

  return (
    <li className="px-3.5 py-3 border-b border-[var(--c-line)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-semibold text-[var(--c-text)] truncate">
              {candidate.name || candidate.email}
            </span>
            {basis && <Tag tone={BASIS_TONE[basis]}>{BASIS_LABEL[basis]}</Tag>}
          </div>

          <div className="flex items-baseline gap-2 mt-1">
            <span className="c-figure c-figure-sm">
              {candidate.speaking_score.toFixed(1)}
            </span>
            <span className="text-[11px] text-[var(--c-faint)]">
              lifetime average over {candidate.sample_size} pieces of scored work
            </span>
          </div>

          {basis === "growth" && (
            <p className="text-[11px] text-[var(--c-muted)] mt-1 leading-relaxed">
              Below the score bar, and suggested anyway — the average carries
              their early work forever. What they did under mentorship:
            </p>
          )}

          <div className="mt-1">
            <Climb candidate={candidate} />
          </div>

          <div className="mt-2 max-w-xs">
            <Bar
              value={candidate.speaking_score}
              label="Lifetime speaking average"
              tone={basis === "growth" ? "muted" : "accent"}
            />
          </div>

          {candidate.sessions_mentored > 0 && (
            <p className="text-[11px] text-[var(--c-faint)] mt-1.5 tabular-nums">
              Already mentored {candidate.sessions_mentored} session
              {candidate.sessions_mentored === 1 ? "" : "s"}
              {candidate.mentor_rating !== null &&
                ` · rated ${candidate.mentor_rating.toFixed(1)}/5`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onDecide(candidate.email, "approved")}
          >
            Approve
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => onDecide(candidate.email, "rejected")}
          >
            Not now
          </Button>
        </div>
      </div>
    </li>
  );
}

export function MentorCandidates({
  data,
  onDecide,
  busy = false,
}: {
  data: MentorCandidatesResponse | null;
  onDecide: (email: string, status: "approved" | "rejected") => void;
  busy?: boolean;
}) {
  if (!data) {
    return (
      <Panel title="Suggested mentors">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  const growthCount = data.suggested.filter(
    (c) => c.suggestion_basis === "growth",
  ).length;

  return (
    <Panel
      title="Suggested mentors"
      subtitle={
        data.suggested.length === 0
          ? "Nobody clears either bar yet"
          : `${data.suggested.length} awaiting your decision${
              growthCount > 0 ? ` · ${growthCount} on growth alone` : ""
            }`
      }
      flush
    >
      {data.suggested.length === 0 ? (
        <Empty>
          A student is suggested either by scoring {data.threshold} or above
          across at least {data.min_sample_size} pieces of work, or by climbing{" "}
          {data.growth_min_gain} points in a closed cycle and finishing at{" "}
          {data.growth_min_final} or better. Nobody has done either yet.
        </Empty>
      ) : (
        <>
          <ul>
            {data.suggested.map((candidate) => (
              <CandidateRow
                key={candidate.email}
                candidate={candidate}
                onDecide={onDecide}
                busy={busy}
              />
            ))}
          </ul>
          <p className="px-3.5 py-2.5 text-[11px] text-[var(--c-faint)] leading-relaxed border-t border-[var(--c-line)]">
            Two ways in: scoring {data.threshold}+ across {data.min_sample_size}+
            pieces of work, or climbing {data.growth_min_gain}+ points in a
            closed cycle and finishing at {data.growth_min_final}+. Students who
            got here by climbing are listed first — the ranking is ordered by the
            lifetime average that hides them.
          </p>
        </>
      )}
    </Panel>
  );
}
