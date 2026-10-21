import { useCallback, useEffect, useState } from "react";
import { api, type Event } from "../../lib/api";
import type { Fleet, Detail, Point } from "./types";

export function useFleetData(
  token: string,
  selected: string,
  hours: number,
  refresh: number,
  view: string,
) {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) {
      setFleet(null);
      setDetail(null);
      setHistory([]);
      setEvents([]);
      setError("");
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<Fleet>(
          "fleet",
          token,
          undefined,
          controller.signal,
        );
        if (active) {
          setFleet(data);
          setError("");
        }
        if (selected) {
          const node = await api<Detail>(
            `fleet/nodes/${selected}`,
            token,
            undefined,
            controller.signal,
          );
          const points =
            view === "agent" || !node.workspace_connected
              ? await api<Point[]>(
                  `fleet/nodes/${selected}/history?hours=${hours}`,
                  token,
                  undefined,
                  controller.signal,
                )
              : [];
          if (active) {
            setDetail(node);
            setHistory(points);
          }
        }
        if (view === "audit") {
          const rows = await api<Event[]>(
            "events",
            token,
            undefined,
            controller.signal,
          );
          if (active) setEvents(rows);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) timer = setTimeout(load, 10000);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, selected, hours, refresh, view]);
  const clearHost = useCallback(() => {
    setDetail(null);
    setHistory([]);
  }, []);
  const clearHistory = useCallback(() => setHistory([]), []);
  return {
    fleet,
    detail: detail?.node.id === selected ? detail : null,
    history,
    events,
    error,
    clearHost,
    clearHistory,
  };
}
