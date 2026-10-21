import React from "react";
import { heatColor, percentText, sparklinePath } from "./fleetModel";

export function Status({ value }: { value: string }) {
  return (
    <span className={`fleet-status fleet-status-${value}`}>
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
export function Table({
  headings,
  children,
}: {
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="fleet-table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
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
