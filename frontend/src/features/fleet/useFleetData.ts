import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Event } from "../../lib/api";
import { backoffDelay } from "./fleetModel";
import type { Fleet, Detail, FleetPoint, Point, Pulse } from "./types";

const FLEET_MS = 10000;
const PULSE_MS = 30000;
const HISTORY_MS = 60000;

export type FleetDataOptions = {
  token: string;
  selected: string;
  /** Node history window, in hours. */
  hours: number;
  refresh: number;
  view: string;
  paused: boolean;
  pulseMinutes: number;
  fleetHours: number;
  cluster: string;
  auditQuery: string;
  auditLimit: number;
};

/** Fleet history buckets span hours/599; polling faster only recomputes the same buckets. */
export function historyInterval(fleetHours: number) {
  return Math.max(HISTORY_MS, ((fleetHours * 3600) / 599) * 1000);
}

/**
 * Polls the fleet every 10s, the pulse wall every 30s and the capacity
 * history at its bucket width, at least 60s (overview only). Pulse and
 * history requests run beside the fleet cycle so a slow aggregate never delays
 * the live refresh, and their timestamps survive effect restarts so a refresh
 * does not repeat them. Polling stops while the tab is hidden or paused,
 * resumes immediately when visible, and backs off on errors.
 */
export function useFleetData(options: FleetDataOptions) {
  const {
    token,
    selected,
    hours,
    refresh,
    view,
    paused,
    pulseMinutes,
    fleetHours,
    cluster,
    auditQuery,
    auditLimit,
  } = options;
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [pulseError, setPulseError] = useState("");
  const [fleetHistory, setFleetHistory] = useState<FleetPoint[] | null>(null);
  const [fleetHistoryError, setFleetHistoryError] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);
  const overview = view === "fleet" && !selected;
  const pulseAt = useRef(0);
  const historyAt = useRef(0);
  // Declared before the polling effect so a changed window is fetched in the same commit.
  useEffect(() => {
    pulseAt.current = 0;
  }, [pulseMinutes, token]);
  useEffect(() => {
    historyAt.current = 0;
  }, [fleetHours, cluster, token]);
  useEffect(() => {
    if (!token) {
      setFetching(false);
      setFleet(null);
      setDetail(null);
      setHistory([]);
      setEvents(null);
      setPulse(null);
      setFleetHistory(null);
      setError("");
      setUpdatedAt(null);
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let loading = false;
    const get = <T>(path: string) => api<T>(path, token, undefined, signal);
    async function loadDetail() {
      const node = await get<Detail>(`fleet/nodes/${selected}`);
      const points =
        view === "agent" || !node.workspace_connected
          ? await get<Point[]>(`fleet/nodes/${selected}/history?hours=${hours}`)
          : [];
      return { node, points };
    }
    function loadAggregates() {
      const now = Date.now();
      if (!overview) return;
      if (now - pulseAt.current >= PULSE_MS) {
        pulseAt.current = now;
        get<Pulse>(`fleet/pulse?minutes=${pulseMinutes}&buckets=60`).then(
          (value) => {
            if (!active) return;
            setPulse(value);
            setPulseError("");
          },
          (err) => {
            // An aborted request never delivered data; allow the next run to retry.
            if (signal.aborted) pulseAt.current = 0;
            else if (active) setPulseError((err as Error).message);
          },
        );
      }
      if (now - historyAt.current >= historyInterval(fleetHours)) {
        historyAt.current = now;
        const scope = cluster ? `&cluster=${encodeURIComponent(cluster)}` : "";
        get<FleetPoint[]>(`fleet/history?hours=${fleetHours}${scope}`).then(
          (value) => {
            if (!active) return;
            setFleetHistory(value);
            setFleetHistoryError("");
          },
          (err) => {
            if (signal.aborted) historyAt.current = 0;
            else if (active) setFleetHistoryError((err as Error).message);
          },
        );
      }
    }
    async function load() {
      if (loading) return;
      loading = true;
      setFetching(true);
      clearTimeout(timer);
      loadAggregates();
      const audit = `events?limit=${auditLimit}${auditQuery ? `&q=${encodeURIComponent(auditQuery)}` : ""}`;
      const [fleetResult, detailResult, auditResult] = await Promise.allSettled(
        [
          get<Fleet>("fleet"),
          selected ? loadDetail() : null,
          view === "audit" ? get<Event[]>(audit) : null,
        ],
      );
      loading = false;
      if (!active) return;
      setFetching(false);
      const failed = [fleetResult, detailResult, auditResult].find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult | undefined;
      if (fleetResult.status === "fulfilled") {
        setFleet(fleetResult.value);
        setUpdatedAt(Date.now());
      }
      if (detailResult.status === "fulfilled" && detailResult.value) {
        setDetail(detailResult.value.node);
        setHistory(detailResult.value.points);
      }
      if (auditResult.status === "fulfilled" && auditResult.value)
        setEvents(auditResult.value);
      failures = failed ? failures + 1 : 0;
      setError(failed ? (failed.reason as Error).message : "");
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (!active || paused || document.hidden) return;
      timer = setTimeout(
        () => void load(),
        failures ? backoffDelay(failures) : FLEET_MS,
      );
    }
    function visibility() {
      if (document.hidden) clearTimeout(timer);
      else if (!paused) void load();
    }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
    };
  }, [
    token,
    selected,
    hours,
    refresh,
    view,
    overview,
    paused,
    pulseMinutes,
    fleetHours,
    cluster,
    auditQuery,
    auditLimit,
  ]);
  const clearHost = useCallback(() => {
    setDetail(null);
    setHistory([]);
  }, []);
  const clearHistory = useCallback(() => setHistory([]), []);
  const clearFleetHistory = useCallback(() => setFleetHistory(null), []);
  return {
    fleet,
    detail: detail?.node.id === selected ? detail : null,
    history,
    events,
    pulse,
    pulseError,
    fleetHistory,
    fleetHistoryError,
    error,
    updatedAt,
    fetching,
    clearHost,
    clearHistory,
    clearFleetHistory,
  };
}
