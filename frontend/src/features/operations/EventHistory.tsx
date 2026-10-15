import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { type Event } from "../../lib/api";
import { Pager } from "../../components/Pager";
export function EventHistory({ events }: { events: Event[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = events.filter(
    (event) =>
      (kind === "all" || event.kind === kind) &&
      (severity === "all" || event.severity === severity) &&
      `${event.title} ${event.detail}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  return (
    <>
      <div className="table-toolbar">
        <input
          aria-label="Search audit events"
          placeholder="Search events or targets"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Event kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All event kinds</option>
          <option value="action">Operator actions</option>
          <option value="alert">Alerts</option>
        </select>
        <select
          aria-label="Event severity"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(1);
          }}
        >
          {["all", "info", "success", "warning", "critical"].map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All severities" : value}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setQuery("");
            setKind("all");
            setSeverity("all");
            setPage(1);
          }}
        >
          Reset filters
        </button>
      </div>
      {filtered.length ? (
        <div className="event-list">
          {filtered.slice((current - 1) * 20, current * 20).map((event) => (
            <div key={event.id}>
              {event.kind === "action" ? (
                <ShieldCheck size={18} />
              ) : (
                <Activity size={18} />
              )}
              <div>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
                <small>
                  {new Date(event.ts * 1000).toLocaleString()} · {event.kind}
                </small>
              </div>
              <span
                className={`badge ${event.severity === "success" ? "good" : event.severity === "critical" ? "bad" : "muted"}`}
              >
                {event.severity}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>
            {events.length
              ? "No events match these filters."
              : "New alerts and operator actions will appear here."}
          </p>
        </div>
      )}
      <Pager
        total={filtered.length}
        page={current}
        size={20}
        onPage={setPage}
      />
    </>
  );
}
