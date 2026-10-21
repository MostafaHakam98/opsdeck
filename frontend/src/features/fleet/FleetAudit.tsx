import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { download, type Event } from "../../lib/api";
import { Section } from "./FleetComponents";
import { eventsCsv, fileStamp, relativeAge } from "./fleetModel";

export const AUDIT_LIMITS = [100, 500, 1000];

/** Fleet audit log; search runs on the server, kind/severity in the browser. */
export function FleetAudit({
  events,
  query,
  onQuery,
  limit,
  onLimit,
  serverTime,
}: {
  events: Event[] | null;
  query: string;
  onQuery: (value: string) => void;
  limit: number;
  onLimit: (value: number) => void;
  serverTime: number | null;
}) {
  const [draft, setDraft] = useState(query);
  const [kind, setKind] = useState("");
  const [severity, setSeverity] = useState("");
  useEffect(() => {
    if (draft === query) return;
    const timer = setTimeout(() => onQuery(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft, query, onQuery]);
  const rows = (events || []).filter(
    (e) => (!kind || e.kind === kind) && (!severity || e.severity === severity),
  );
  const kinds = [...new Set((events || []).map((e) => e.kind))].sort();
  const severities = [...new Set((events || []).map((e) => e.severity))].sort();
  const now = serverTime ?? Date.now() / 1000;
  return (
    <>
      <div className="fleet-title">
        <div>
          <h1>Fleet audit</h1>
          <p>Enrollment, credential, settings and maintenance changes.</p>
        </div>
      </div>
      <Section
        title="Recent events"
        actions={
          <button
            type="button"
            className="secondary"
            disabled={!rows.length}
            onClick={() =>
              download(
                `opsdeck-fleet-audit-${fileStamp()}.csv`,
                eventsCsv(rows),
                "text/csv",
              )
            }
          >
            <Download size={15} />
            Export CSV
          </button>
        }
      >
        <div className="fleet-filter">
          <label className="fleet-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search events"
              placeholder="Search titles and details"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <label className="fleet-select">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="fleet-select">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">All severities</option>
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="fleet-select">
            Show
            <select
              value={limit}
              onChange={(e) => onLimit(Number(e.target.value))}
            >
              {AUDIT_LIMITS.map((value) => (
                <option key={value} value={value}>
                  Newest {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="fleet-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Details</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <time dateTime={new Date(e.ts * 1000).toISOString()}>
                      {relativeAge(now - e.ts)}
                    </time>
                    <small>{new Date(e.ts * 1000).toLocaleString()}</small>
                  </td>
                  <td>{e.title}</td>
                  <td className="fleet-wrap">{e.detail}</td>
                  <td>
                    <span
                      className={`fleet-severity fleet-severity-${e.severity}`}
                    >
                      {e.severity}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr className="fleet-empty-row">
                  <td colSpan={4}>
                    {events === null
                      ? "Loading events..."
                      : events.length
                        ? "No events match these filters."
                        : query
                          ? "No events match this search. Try a shorter term."
                          : "No access changes recorded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && events && (
          <p className="fleet-footnote">
            Showing {rows.length} of the newest {events.length} events
            {query ? ` matching "${query}"` : ""}.
          </p>
        )}
      </Section>
    </>
  );
}
