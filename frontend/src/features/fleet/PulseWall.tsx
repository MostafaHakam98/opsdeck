import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Section, Segmented, StatusDot } from "./FleetComponents";
import {
  bucketRange,
  clockTime,
  displayState,
  HEAT_LEGEND,
  heatColor,
  METRIC_LABELS,
  pulseRowLabel,
  pulseSeries,
  pulseStats,
  STATE_LABELS,
} from "./fleetModel";
import type { Node, Pulse, PulseMetric } from "./types";

const BUCKETS = 60;
const EMPTY: (number | null)[] = Array(BUCKETS).fill(null);
const TOOLTIP_ID = "fleet-pulse-tooltip";
export const PULSE_WINDOWS = [
  { value: 60, label: "1h" },
  { value: 360, label: "6h" },
  { value: 1440, label: "24h" },
];

type Active = { id: string; index: number; x: number; y: number };

/** Current reading: the live metric for online hosts, else the last bucket. */
function currentValue(
  node: Node,
  metric: PulseMetric,
  values: (number | null)[],
) {
  const live = node.metrics?.[metric];
  if (node.status === "online" && typeof live === "number") return live;
  return pulseStats(values).current;
}

const PulseRow = memo(function PulseRow({
  node,
  values,
  metric,
  minutes,
  activeIndex,
  onOpen,
  onActivate,
}: {
  node: Node;
  values: (number | null)[];
  metric: PulseMetric;
  minutes: number;
  activeIndex: number | null;
  onOpen: (id: string) => void;
  onActivate: (id: string, index: number | null, cells?: HTMLElement) => void;
}) {
  const stats = pulseStats(values);
  const now = currentValue(node, metric, values);
  const state = displayState(node);
  const cellsOf = (row: HTMLElement) =>
    row.querySelector<HTMLElement>(".pulse-cells") || undefined;
  function key(event: React.KeyboardEvent<HTMLButtonElement>) {
    const row = event.currentTarget;
    const last = values.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      onActivate(node.id, Math.max(0, Math.min(last, index)), cellsOf(row));
    };
    const current = activeIndex ?? last;
    if (event.key === "ArrowLeft") move(current - 1);
    else if (event.key === "ArrowRight") move(current + 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Escape") onActivate(node.id, null);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = [
        ...(row.parentElement?.querySelectorAll<HTMLButtonElement>(
          ".pulse-row",
        ) || []),
      ];
      const next =
        rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  }
  return (
    <button
      type="button"
      className="pulse-row"
      data-state={state}
      aria-label={pulseRowLabel(node.name, metric, now, stats, minutes)}
      aria-describedby={activeIndex !== null ? TOOLTIP_ID : undefined}
      onClick={() => onOpen(node.id)}
      onKeyDown={key}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible"))
          onActivate(node.id, values.length - 1, cellsOf(event.currentTarget));
      }}
      onBlur={() => onActivate(node.id, null)}
      onPointerLeave={() => onActivate(node.id, null)}
      onPointerMove={(event) => {
        const cells = cellsOf(event.currentTarget);
        if (!cells) return;
        const rect = cells.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right) {
          if (activeIndex !== null) onActivate(node.id, null);
          return;
        }
        const index = Math.min(
          values.length - 1,
          Math.floor(
            ((event.clientX - rect.left) / rect.width) * values.length,
          ),
        );
        if (index !== activeIndex) onActivate(node.id, index, cells);
      }}
    >
      <span className="pulse-name">
        <StatusDot value={state} />
        <span>{node.name}</span>
      </span>
      <span className="pulse-cells" aria-hidden="true">
        {values.map((value, i) => (
          <i
            key={i}
            className={i === activeIndex ? "active" : undefined}
            style={{ background: heatColor(value) }}
          />
        ))}
      </span>
      <span className="pulse-now">
        {now === null ? "No data" : `${Math.round(now)}%`}
      </span>
    </button>
  );
});

export function PulseWall({
  nodes,
  pulse,
  error,
  metric,
  minutes,
  onMetric,
  onMinutes,
  onOpen,
}: {
  nodes: Node[];
  pulse: Pulse | null;
  error: string;
  metric: PulseMetric;
  minutes: number;
  onMetric: (metric: PulseMetric) => void;
  onMinutes: (minutes: number) => void;
  onOpen: (id: string) => void;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const onActivate = useCallback(
    (id: string, index: number | null, cells?: HTMLElement) => {
      if (index === null) {
        setActive((current) => (current?.id === id ? null : current));
        return;
      }
      if (!cells) return;
      const rect = cells.getBoundingClientRect();
      const count = cells.childElementCount || BUCKETS;
      const center = rect.left + ((index + 0.5) / count) * rect.width;
      setActive({
        id,
        index,
        x: Math.max(120, Math.min(window.innerWidth - 120, center)),
        y: rect.top,
      });
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    const hide = () => setActive(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [active]);
  const series = useMemo(
    () =>
      new Map(
        nodes.map((node) => {
          const values = pulseSeries(pulse, node.id, metric);
          return [node.id, values.length ? values : EMPTY];
        }),
      ),
    [nodes, pulse, metric],
  );
  const activeNode = active && nodes.find((n) => n.id === active.id);
  const activeValue = active ? series.get(active.id)?.[active.index] : null;
  const bucketMinutes = pulse
    ? Math.round(pulse.bucket_seconds / 60)
    : Math.round(minutes / BUCKETS);
  return (
    <Section
      title="Fleet pulse"
      className="pulse-section"
      actions={
        <>
          <Segmented
            label="Pulse metric"
            value={metric}
            onChange={onMetric}
            options={(["cpu", "memory", "gpu"] as PulseMetric[]).map((m) => ({
              value: m,
              label: METRIC_LABELS[m],
            }))}
          />
          <Segmented
            label="Pulse window"
            value={minutes}
            onChange={onMinutes}
            options={PULSE_WINDOWS}
          />
        </>
      }
    >
      <p className="pulse-caption">
        Each row is a host and each cell averages {METRIC_LABELS[metric]} over{" "}
        {bucketMinutes === 1 ? "one minute" : `${bucketMinutes} minutes`}.
        Select a row to open the host; use the arrow keys to read cells.
      </p>
      {error && (
        <p className="fleet-inline-error" role="status">
          Pulse data is unavailable: {error}. Rows show no samples until the
          next refresh.
        </p>
      )}
      {nodes.length ? (
        <div className="pulse-scroll">
          <div className="pulse-grid">
            <div className="pulse-axis" aria-hidden="true">
              <span />
              <span className="pulse-axis-times">
                <span>
                  {pulse ? clockTime(pulse.start, minutes > 360) : ""}
                </span>
                <span>
                  {pulse
                    ? clockTime((pulse.start + pulse.end) / 2, minutes > 360)
                    : ""}
                </span>
                <span>{pulse ? clockTime(pulse.end, minutes > 360) : ""}</span>
              </span>
              <span>Now</span>
            </div>
            <div className="pulse-rows">
              {nodes.map((node) => (
                <PulseRow
                  key={node.id}
                  node={node}
                  values={series.get(node.id) || EMPTY}
                  metric={metric}
                  minutes={minutes}
                  activeIndex={active?.id === node.id ? active.index : null}
                  onOpen={onOpen}
                  onActivate={onActivate}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="fleet-empty">No hosts match these filters.</p>
      )}
      <div className="pulse-legend" aria-label="Heat scale">
        <span>Idle</span>
        {HEAT_LEGEND.map((step) => (
          <i
            key={step.level}
            title={step.label}
            style={{ background: `var(--heat-${step.level})` }}
          />
        ))}
        <span>Saturated</span>
        <i className="pulse-legend-empty" title="No samples" />
        <span>No data</span>
      </div>
      {active && activeNode && (
        <div
          id={TOOLTIP_ID}
          className="pulse-tooltip"
          role="tooltip"
          style={{ left: active.x, top: active.y }}
        >
          <strong>{activeNode.name}</strong>
          <span>
            {pulse
              ? bucketRange(pulse, active.index)
                  .map((t) => clockTime(t, minutes > 360))
                  .join(" to ")
              : "Waiting for pulse data"}
          </span>
          <span>
            {METRIC_LABELS[metric]}{" "}
            {typeof activeValue === "number"
              ? `${activeValue.toFixed(1)}%`
              : "no samples"}
            {activeNode.maintenance ? " (maintenance)" : ""}
          </span>
          <small>{STATE_LABELS[displayState(activeNode)]}</small>
        </div>
      )}
    </Section>
  );
}
