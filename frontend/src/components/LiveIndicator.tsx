import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./overlays.css";

/** Compact age for the live indicator: "4s", "3m", "2h". */
export function formatAge(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Live data status: "Live, updated 4s ago", "Paused" or "Reconnecting". */
export function LiveIndicator({
  updatedAt,
  error,
  paused,
  onTogglePause,
}: {
  updatedAt: number | null /* ms epoch */;
  error?: string;
  paused?: boolean;
  onTogglePause?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const age = updatedAt === null ? null : (now - updatedAt) / 1000;
  const state = error
    ? "reconnecting"
    : paused
      ? "paused"
      : age === null
        ? "connecting"
        : age > 120
          ? "stale"
          : "live";
  const label =
    state === "reconnecting"
      ? "Reconnecting"
      : state === "paused"
        ? "Paused"
        : state === "connecting"
          ? "Connecting"
          : `Live, updated ${formatAge(age!)} ago`;
  const announcement =
    state === "reconnecting"
      ? "Reconnecting"
      : state === "paused"
        ? "Live updates paused"
        : state === "connecting"
          ? "Connecting"
          : "Live updates on";
  return (
    <span className={`live-indicator ${state}`}>
      <span
        className="live-indicator-state"
        title={
          error ||
          (updatedAt
            ? `Last update ${new Date(updatedAt).toLocaleString()}`
            : undefined)
        }
      >
        <i aria-hidden="true" />
        <span>{label}</span>
      </span>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
      {onTogglePause && (
        <button
          type="button"
          className="live-indicator-toggle"
          aria-label={paused ? "Resume live updates" : "Pause live updates"}
          title={paused ? "Resume live updates" : "Pause live updates"}
          aria-pressed={Boolean(paused)}
          onClick={onTogglePause}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      )}
    </span>
  );
}
