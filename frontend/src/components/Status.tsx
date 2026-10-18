export type Tone = "good" | "warn" | "bad" | "info" | "muted";

const tones: Record<string, Tone> = {
  healthy: "good",
  running: "good",
  active: "good",
  success: "good",
  passed: "good",
  accepted: "good",
  done: "good",
  verified: "good",
  measured: "good",
  ok: "good",
  ready: "good",
  critical: "bad",
  failed: "bad",
  unavailable: "bad",
  unhealthy: "bad",
  not_applied: "bad",
  error: "bad",
  stale: "warn",
  warning: "warn",
  pending: "warn",
  queued: "warn",
  collecting: "warn",
  inactive: "warn",
  verify: "warn",
  restarting: "warn",
  paused: "warn",
  draining: "warn",
  opportunity: "info",
  created: "info",
  projection: "info",
};

/** Maps a collector, job, event or recommendation status to one color meaning. */
export function tone(value?: string | null): Tone {
  return tones[String(value || "").toLowerCase()] || "muted";
}

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`badge ${tone(value)}`}>
      <i />
      {label ?? value.replaceAll("_", " ")}
    </span>
  );
}
