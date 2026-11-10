import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import {
  accessAddress,
  addressSource,
  heatColor,
  percentText,
  sparklinePath,
} from "./fleetModel";
import type { Node } from "./types";

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
 * Where to reach the host, with a copy button. The title says whether an
 * operator set it or the agent reported it.
 */
export function HostAddress({
  node,
  empty = "No address",
}: {
  node: Node;
  empty?: string;
}) {
  const [copied, setCopied] = useState(false);
  const address = accessAddress(node);
  if (!address) return <NotReported>{empty}</NotReported>;
  const reported = node.addresses?.find((a) => a.address === address);
  const source =
    addressSource(node) === "operator"
      ? "Set by an operator"
      : `Reported by the agent${reported?.interface ? ` on ${reported.interface}` : ""}`;
  return (
    <span className="fleet-address" title={source}>
      <code>{address}</code>
      <button
        type="button"
        className="fleet-icon-button"
        aria-label={copied ? `Copied ${address}` : `Copy address ${address}`}
        onClick={async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <Check size={12} aria-hidden="true" />
        ) : (
          <Copy size={12} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
/** Why the host shows this address, or why it shows none. */
export function addressNote(node: Node) {
  const source = addressSource(node);
  if (source === "operator") return "Access address set in Host settings";
  if (source === "agent") {
    const primary = node.addresses!.find(
      (a) => a.address === accessAddress(node),
    );
    return `Reported by the agent${primary?.interface ? ` on ${primary.interface}` : ""}`;
  }
  return node.status === "waiting"
    ? "The agent has not connected yet"
    : "This agent reports no address yet. Update the agent, or set an access address in Host settings.";
}
/**
 * Shows how to reach a host while its name is hovered or focused. The card is
 * portalled to the body and fixed to the viewport, so neither scrolling
 * containers nor the pulse wall's sticky name column can clip or cover it; it
 * closes on scroll and resize.
 */
export function HostHover({
  node,
  children,
}: {
  node: Node;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [anchor]);
  const address = accessAddress(node);
  const others = (node.addresses || [])
    .map((a) => a.address)
    .filter((a) => a !== address);
  const below = !anchor || anchor.bottom + 150 < window.innerHeight;
  return (
    <span
      className="host-hover"
      onPointerEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setAnchor(null)}
      onFocus={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      onBlur={() => setAnchor(null)}
    >
      {React.cloneElement(children, {
        "aria-describedby": anchor ? id : undefined,
      })}
      {anchor &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="host-tooltip"
            data-placement={below ? "below" : "above"}
            style={{
              left: Math.max(8, Math.min(window.innerWidth - 288, anchor.left)),
              top: below ? anchor.bottom + 6 : anchor.top - 6,
            }}
          >
            <strong>{node.name}</strong>
            <span className="host-tooltip-address">
              {address ? <code>{address}</code> : "No address yet"}
            </span>
            <small>{addressNote(node)}</small>
            {others.length > 0 && <small>Also {others.join(", ")}</small>}
            <small>
              {[node.hostname, node.cluster].filter(Boolean).join(" · ")}
            </small>
          </span>,
          document.body,
        )}
    </span>
  );
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
