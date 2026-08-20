/**
 * The programme in one screen: is any of this working.
 *
 * The design problem here is honesty under pressure. This is the number a
 * department head reads before funding another semester, which makes it
 * exactly the number someone would want to flatter. Two rules hold it in
 * place, and both come straight from the API:
 *
 *   The improvement rate is over MEASURED cycles, and the evidence rate sits
 *   immediately beside it at the same size. "100% improved" and "of the 25% of
 *   cycles anyone could measure" are one fact, so they are one row.
 *
 *   Nothing measured renders as an em-dash, never 0%. A rate over an empty
 *   denominator is unknown, and putting a red zero in front of a teacher whose
 *   programme has not finished a cycle yet is a lie about their work.
 */
import { useEffect, useState } from "react";
import { fetchProgramme, type ProgrammeReport } from "../../buddyApi";
import { Bar, Delta, Empty, Field, Panel, Stat, Tag } from "../console/Console";

const HEALTH_LABEL: Record<string, string> = {
  on_track: "On track",
  not_started: "Not started",
  quiet: "Quiet",
  stalled: "Stalled",
  no_cycle: "No cycle",
  ended: "Ended",
};

const HEALTH_ORDER = ["stalled", "quiet", "not_started", "no_cycle", "on_track"];

function pct(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)}`;
}

export function ProgrammePanel() {
  const [report, setReport] = useState<ProgrammeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProgramme()
      .then((data) => alive && setReport(data))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <Panel title="Programme">
        <Empty>Could not load the rollup. {error}</Empty>
      </Panel>
    );
  }

  if (!report) {
    return (
      <Panel title="Programme">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  const measuredNothing = report.cycles_measured === 0;

  return (
    <div className="space-y-3">
      <Panel
        title="Outcomes"
        subtitle="From cycle summaries frozen at close — these cannot drift"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat
            label="Improved"
            value={pct(report.improvement_rate)}
            suffix="%"
            tone={
              report.improvement_rate === null
                ? "default"
                : report.improvement_rate >= 0.5
                  ? "pos"
                  : "warn"
            }
            hint={
              measuredNothing
                ? "No cycle has been measurable yet"
                : `${report.verdicts.improved} of ${report.cycles_measured} measured`
            }
          />
          <Stat
            label="Measurable"
            value={pct(report.evidence_rate)}
            suffix="%"
            tone={
              report.evidence_rate !== null && report.evidence_rate < 0.5
                ? "warn"
                : "default"
            }
            hint={`${report.cycles_measured} of ${report.cycles_closed} closed cycles`}
          />
          <Stat
            label="Sessions kept"
            value={pct(report.keep_rate)}
            suffix="%"
            hint={`${report.sessions_completed} kept, ${report.sessions_missed} missed`}
          />
          <Stat
            label="Cycles closed"
            value={report.cycles_closed}
            hint={`${report.cycles_active} still running`}
          />
        </div>

        {report.evidence_rate !== null && report.evidence_rate < 0.5 && (
          <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--c-warn)] bg-[var(--c-warn-wash)] border border-[rgba(201,144,56,0.25)] rounded-[4px] px-2.5 py-2">
            Under half of closed cycles could be measured at all. The improvement
            rate above is real, but it describes a minority of the programme —
            mentees need scored work inside the cycle window for it to mean more.
          </p>
        )}

        <div className="mt-4 pt-3 border-t border-[var(--c-line)] grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              ["improved", "Improved", "pos"],
              ["held", "Held", "neutral"],
              ["declined", "Declined", "neg"],
              ["not_enough_evidence", "Not measured", "neutral"],
            ] as const
          ).map(([key, label, tone]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Tag tone={tone}>{label}</Tag>
              <span className="c-figure c-figure-sm">{report.verdicts[key]}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Movement by axis"
        subtitle="Averaged across the cycles that could measure each one"
      >
        {report.axes.every((a) => a.cycles_measured === 0) ? (
          <Empty>
            Nothing has been measured yet. An axis needs scored work both before
            and inside a cycle before it can report movement.
          </Empty>
        ) : (
          <div className="space-y-3.5">
            {report.axes.map((axis) => (
              <div key={axis.key}>
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-[12.5px] text-[var(--c-text)]">
                    {axis.label}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <Delta value={axis.mean_delta} />
                    <span className="text-[11px] text-[var(--c-faint)] tabular-nums">
                      {axis.cycles_measured === 0
                        ? "not measured"
                        : `${axis.cycles_measured} ${
                            axis.cycles_measured === 1 ? "cycle" : "cycles"
                          }`}
                    </span>
                  </span>
                </div>
                <Bar
                  value={axis.mean_final}
                  label={`${axis.label} mean final score`}
                  tone={
                    axis.mean_delta === null
                      ? "muted"
                      : axis.mean_delta >= 0
                        ? "pos"
                        : "neg"
                  }
                />
                {axis.mean_baseline !== null && axis.mean_final !== null && (
                  <p className="text-[11px] text-[var(--c-faint)] mt-1 tabular-nums">
                    {axis.mean_baseline.toFixed(1)} → {axis.mean_final.toFixed(1)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Reach">
          <Field label="Pairings">
            {report.pairs_active} active
            <span className="text-[var(--c-faint)]"> / {report.pairs_total} ever</span>
          </Field>
          <Field label="Students mentored">{report.mentees_served}</Field>
          <Field label="Approved mentors">{report.mentors_approved}</Field>
          <Field label="Sessions planned">{report.sessions_planned}</Field>
        </Panel>

        <Panel title="Are the pairings running" subtitle="Active pairings only">
          {Object.keys(report.health).length === 0 ? (
            <Empty>No active pairings.</Empty>
          ) : (
            <div className="space-y-1">
              {HEALTH_ORDER.filter((state) => report.health[state]).map((state) => (
                <Field key={state} label={HEALTH_LABEL[state] ?? state}>
                  {report.health[state]}
                </Field>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
