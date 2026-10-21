import React, { useRef } from "react";
import { heatColor, percentText, sparklinePath } from "./fleetModel";

export function Status({ value, pill }: { value: string; pill?: boolean }) {
  return (
    <span
      className={`fleet-status fleet-status-${value}${pill ? " fleet-status-pill" : ""}`}
    >
      <i />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function StatusDot({ value, label }: { value: string; label?: string }) {
  return (
    <i
      className={`fleet-dot fleet-dot-${value}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
/** Muted placeholder for a value the agent did not send. */
export function NotReported({
  children = "Not reported",
}: {
  children?: React.ReactNode;
}) {
  return <span className="fleet-na">{children}</span>;
}
/**
 * Data table. `numeric` names right-aligned columns; an empty body renders one
 * quiet row instead of a header-only table.
 */
export function Table({
  headings,
  numeric = [],
  empty = "Not reported by this agent",
  children,
}: {
  headings: string[];
  numeric?: string[];
  empty?: string;
  children: React.ReactNode;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="fleet-table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h} className={numeric.includes(h) ? "num" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr className="fleet-empty-row">
              <td colSpan={headings.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
/** Status tone for a 0..100 utilization, matching the alert thresholds. */
export function usageTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "none";
  return value >= 90 ? "bad" : value >= 80 ? "warn" : "good";
}
/** Thin 0..100 usage bar tinted by the alert thresholds; decorative. */
export function UsageBar({
  value,
  tone,
}: {
  value: number | null | undefined;
  tone?: "accent";
}) {
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  return (
    <span
      className={`fleet-usage fleet-usage-${v === null ? "none" : tone || usageTone(v)}`}
      aria-hidden="true"
    >
      {v !== null && (
        <i style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
      )}
    </span>
  );
}
/** WAI-ARIA tabs with roving focus (arrow keys, Home, End). */
export function Tabs<T extends string>({
  label,
  idPrefix,
  tabs,
  value,
  onChange,
}: {
  label: string;
  idPrefix: string;
  tabs: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  function key(event: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].value);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <div className="fleet-tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${index}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => key(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
export function Section({
  title,
  children,
  actions,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const id = `fleet-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={`fleet-section ${className}`} aria-labelledby={id}>
      <header className="fleet-section-head">
        <h2 id={id}>{title}</h2>
        {actions && <div className="fleet-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
/** Small toggle group; each option is a button with aria-pressed. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="fleet-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
/** A labelled 0..100 bar shaded with the same heat ramp as the pulse wall. */
export function MiniBar({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  return (
    <div className="fleet-minibar">
      <span>{label}</span>
      <span className="fleet-minibar-track" aria-hidden="true">
        {v !== null && (
          <i
            style={{
              width: `${Math.min(100, Math.max(0, v))}%`,
              background: heatColor(v),
            }}
          />
        )}
      </span>
      <strong>{v === null ? "No data" : percentText(v, 0)}</strong>
    </div>
  );
}
export function Sparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const path = sparklinePath(values, 120, 28);
  return (
    <svg
      className="fleet-sparkline"
      viewBox="-2 -2 124 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line x1="0" x2="120" y1="28" y2="28" />
      {path && <path d={path} />}
    </svg>
  );
}
