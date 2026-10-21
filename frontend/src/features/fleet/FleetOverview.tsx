import { lazy, Suspense } from "react";
import { AlertTriangle, CheckCircle2, OctagonAlert, Plus } from "lucide-react";
import { Section, Segmented } from "./FleetComponents";
import { PulseWall } from "./PulseWall";
import { HostsView, type HostsViewProps } from "./HostsView";
import { Onboarding } from "./Onboarding";
import {
  DISPLAY_STATES,
  percentText,
  STATE_LABELS,
  stateSegments,
} from "./fleetModel";
import type {
  Alert,
  FleetPoint,
  Node,
  Pulse,
  PulseMetric,
  Summary,
} from "./types";

const FleetCapacityChart = lazy(() => import("./FleetCapacityChart"));
export const HISTORY_WINDOWS = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
];

export type FleetOverviewProps = {
  loaded: boolean;
  title: string;
  scoped: Node[];
  summary: Summary | null;
  alerts: Alert[];
  pulse: Pulse | null;
  pulseError: string;
  pulseMetric: PulseMetric;
  pulseMinutes: number;
  onPulseMetric: (metric: PulseMetric) => void;
  onPulseMinutes: (minutes: number) => void;
  history: FleetPoint[] | null;
  historyError: string;
  historyHours: number;
  onHistoryHours: (hours: number) => void;
  onOpen: (id: string) => void;
  onEnroll: () => void;
  hosts: HostsViewProps;
};

export function FleetOverview(props: FleetOverviewProps) {
  const { summary, scoped } = props;
  return (
    <>
      <div className="fleet-title">
        <div>
          <h1>{props.title}</h1>
          <p>Which hosts need attention, and how much capacity is in use.</p>
        </div>
        <button className="primary" onClick={props.onEnroll}>
          <Plus size={16} />
          Enroll host
        </button>
      </div>
      {!props.loaded ? (
        <p className="fleet-empty">Connecting to the fleet server...</p>
      ) : !scoped.length && !props.hosts.allCount ? (
        <Onboarding onEnroll={props.onEnroll} />
      ) : (
        <>
          <StatusStrip nodes={scoped} summary={summary} />
          <PulseWall
            nodes={props.hosts.nodes}
            pulse={props.pulse}
            error={props.pulseError}
            metric={props.pulseMetric}
            minutes={props.pulseMinutes}
            onMetric={props.onPulseMetric}
            onMinutes={props.onPulseMinutes}
            onOpen={props.onOpen}
          />
          <div className="fleet-split">
            <AlertsPanel alerts={props.alerts} onOpen={props.onOpen} />
            <Section
              title="Fleet capacity"
              actions={
                <Segmented
                  label="Capacity window"
                  value={props.historyHours}
                  onChange={props.onHistoryHours}
                  options={HISTORY_WINDOWS}
                />
              }
            >
              {props.historyError ? (
                <p className="fleet-inline-error" role="status">
                  Capacity history is unavailable: {props.historyError}. It
                  retries every minute.
                </p>
              ) : props.history === null ? (
                <p className="fleet-empty">Loading capacity history...</p>
              ) : !props.history.length ? (
                <p className="fleet-empty">
                  No samples in this window yet. History appears once agents
                  send telemetry.
                </p>
              ) : (
                <Suspense
                  fallback={<p className="fleet-empty">Loading chart...</p>}
                >
                  <FleetCapacityChart
                    points={props.history}
                    hours={props.historyHours}
                  />
                </Suspense>
              )}
            </Section>
          </div>
          <HostsView {...props.hosts} />
        </>
      )}
    </>
  );
}

function StatusStrip({
  nodes,
  summary,
}: {
  nodes: Node[];
  summary: Summary | null;
}) {
  const segments = stateSegments(nodes);
  const alerts = summary ? summary.alerts_critical + summary.alerts_warning : 0;
  return (
    <section className="fleet-strip" aria-label="Fleet summary">
      <div className="fleet-state-bar" aria-hidden="true">
        {segments.map((s) => (
          <i
            key={s.state}
            className={`fleet-bg-${s.state}`}
            style={{ flexGrow: s.count }}
            title={`${STATE_LABELS[s.state]}: ${s.count}`}
          />
        ))}
      </div>
      <ul className="fleet-state-legend">
        {DISPLAY_STATES.map((state) => {
          const count = segments.find((s) => s.state === state)?.count || 0;
          return (
            <li key={state} className={count ? "" : "is-zero"}>
              <i
                className={`fleet-dot fleet-dot-${state}`}
                aria-hidden="true"
              />
              {STATE_LABELS[state]} <strong>{count}</strong>
            </li>
          );
        })}
      </ul>
      <dl className="fleet-kpis">
        <div>
          <dt>Hosts online</dt>
          <dd>
            {summary?.online ?? 0}
            <span> / {summary?.hosts ?? nodes.length}</span>
          </dd>
          <small>
            {summary?.maintenance
              ? `${summary.maintenance} in maintenance`
              : `${summary?.clusters ?? 0} ${summary?.clusters === 1 ? "cluster" : "clusters"}`}
          </small>
        </div>
        <Readout label="Average CPU" value={summary?.avg_cpu} />
        <Readout label="Average memory" value={summary?.avg_memory} />
        <Readout label="Average GPU" value={summary?.avg_gpu} />
        <div>
          <dt>CI jobs running</dt>
          <dd>{summary?.ci_running ?? "No data"}</dd>
          <small>Sum across online hosts</small>
        </div>
        <div>
          <dt>Open alerts</dt>
          <dd
            className={
              summary?.alerts_critical ? "tone-bad" : alerts ? "tone-warn" : ""
            }
          >
            {alerts}
          </dd>
          <small>
            {summary?.alerts_critical ?? 0} critical,{" "}
            {summary?.alerts_warning ?? 0} warning
          </small>
        </div>
      </dl>
    </section>
  );
}
function Readout({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value == null ? "No data" : percentText(value, 0)}</dd>
      <small>Across online hosts</small>
    </div>
  );
}

const LIMIT = 30;
function AlertsPanel({
  alerts,
  onOpen,
}: {
  alerts: Alert[];
  onOpen: (id: string) => void;
}) {
  return (
    <Section
      title="Needs attention"
      className="fleet-alerts"
      actions={
        alerts.length ? (
          <span className="fleet-count">{alerts.length} open</span>
        ) : undefined
      }
    >
      {alerts.length ? (
        <ul className="fleet-alert-list">
          {alerts.slice(0, LIMIT).map((alert) => (
            <li key={alert.key}>
              <button
                type="button"
                className={`fleet-alert fleet-alert-${alert.severity}`}
                onClick={() => onOpen(alert.node_id)}
              >
                {alert.severity === "critical" ? (
                  <OctagonAlert size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>
                  <span className="visually-hidden">
                    {alert.severity === "critical" ? "Critical: " : "Warning: "}
                  </span>
                  <strong>{alert.node_name}</strong>
                  <span>{alert.title}</span>
                  <small>{alert.detail}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="fleet-calm">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>All hosts within thresholds</strong>
            <p>
              Alerts open when an agent goes offline or stale, CPU or memory
              reaches 80% (critical at 90%), I/O pressure reaches 10% (critical
              at 25%), or a collector reports degraded or unavailable. Hosts in
              maintenance raise no alerts.
            </p>
          </div>
        </div>
      )}
      {alerts.length > LIMIT && (
        <p className="fleet-context fleet-pad">
          Showing the first {LIMIT} of {alerts.length}. Search or filter by
          cluster to narrow the list.
        </p>
      )}
    </Section>
  );
}
