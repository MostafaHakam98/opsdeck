import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Search,
} from "lucide-react";
import {
  MiniBar,
  Section,
  Segmented,
  Sparkline,
  Status,
} from "./FleetComponents";
import {
  DISPLAY_STATES,
  displayState,
  groupByCluster,
  METRIC_LABELS,
  percentText,
  pulseSeries,
  relativeAge,
  STATE_LABELS,
  stateCounts,
  type SortDirection,
  type SortKey,
} from "./fleetModel";
import type { Node, Pulse, PulseMetric } from "./types";

export type HostLayout = "grid" | "table";
export type HostsViewProps = {
  nodes: Node[];
  scoped: Node[];
  allCount: number;
  clusters: string[];
  query: string;
  onQuery: (value: string) => void;
  state: string;
  onState: (value: string) => void;
  cluster: string;
  onCluster: (value: string) => void;
  layout: HostLayout;
  onLayout: (value: HostLayout) => void;
  grouped: boolean;
  onGrouped: (value: boolean) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey, direction?: SortDirection) => void;
  pulse: Pulse | null;
  pulseMetric: PulseMetric;
  serverTime: number | null;
  onOpen: (id: string) => void;
  onExport: () => void;
};

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Host" },
  { key: "cluster", label: "Cluster" },
  { key: "status", label: "Status" },
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "Memory" },
  { key: "gpu", label: "GPU" },
  { key: "ci", label: "CI running" },
  { key: "last_seen", label: "Last seen" },
];

const SORTS = [
  { value: "name:asc", label: "Name" },
  { value: "status:asc", label: "Status, attention first" },
  { value: "cpu:desc", label: "CPU, highest first" },
  { value: "memory:desc", label: "Memory, highest first" },
  { value: "gpu:desc", label: "GPU, highest first" },
  { value: "ci:desc", label: "CI running, most first" },
  { value: "last_seen:asc", label: "Last seen, oldest first" },
  { value: "cluster:asc", label: "Cluster" },
];

export function HostsView(props: HostsViewProps) {
  const counts = stateCounts(props.scoped);
  const groups = props.grouped
    ? groupByCluster(props.nodes)
    : [{ cluster: "", nodes: props.nodes }];
  const render = (nodes: Node[]) =>
    props.layout === "table" ? (
      <HostTable {...props} nodes={nodes} />
    ) : (
      <div className="host-grid">
        {nodes.map((node) => (
          <HostCard key={node.id} node={node} {...props} />
        ))}
      </div>
    );
  return (
    <Section
      title={`${props.nodes.length} ${props.nodes.length === 1 ? "host" : "hosts"}`}
      className="fleet-hosts"
      actions={
        <>
          <Segmented
            label="Host layout"
            value={props.layout}
            onChange={props.onLayout}
            options={[
              { value: "grid", label: "Grid" },
              { value: "table", label: "Table" },
            ]}
          />
          <button
            type="button"
            className="secondary"
            onClick={props.onExport}
            disabled={!props.nodes.length}
          >
            <Download size={15} />
            Export CSV
          </button>
        </>
      }
    >
      <div className="fleet-filter">
        <label className="fleet-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search hosts"
            placeholder="Search hosts, clusters or notes"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
          />
        </label>
        <label className="fleet-select">
          Cluster
          <select
            aria-label="Cluster filter"
            value={props.cluster}
            onChange={(event) => props.onCluster(event.target.value)}
          >
            <option value="">All clusters</option>
            {props.clusters.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {props.layout === "grid" && (
          <label className="fleet-select">
            Sort
            <select
              aria-label="Sort hosts"
              value={`${props.sortKey}:${props.sortDirection}`}
              onChange={(event) => {
                const [key, direction] = event.target.value.split(":");
                props.onSort(key as SortKey, direction as SortDirection);
              }}
            >
              {!SORTS.some(
                (s) => s.value === `${props.sortKey}:${props.sortDirection}`,
              ) && (
                <option value={`${props.sortKey}:${props.sortDirection}`}>
                  Table order
                </option>
              )}
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="fleet-check">
          <input
            type="checkbox"
            checked={props.grouped}
            onChange={(e) => props.onGrouped(e.target.checked)}
          />
          Group by cluster
        </label>
      </div>
      <div className="fleet-chips" role="group" aria-label="Status filter">
        <button
          type="button"
          aria-pressed={!props.state}
          onClick={() => props.onState("")}
        >
          All <span>{props.scoped.length}</span>
        </button>
        {DISPLAY_STATES.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={props.state === state}
            disabled={!counts[state] && props.state !== state}
            onClick={() => props.onState(props.state === state ? "" : state)}
          >
            <i className={`fleet-dot fleet-dot-${state}`} aria-hidden="true" />
            {STATE_LABELS[state]} <span>{counts[state]}</span>
          </button>
        ))}
      </div>
      {groups.map((group) =>
        group.cluster ? (
          <div className="host-group" key={group.cluster}>
            <h3>
              {group.cluster}{" "}
              <span>
                {group.nodes.length}{" "}
                {group.nodes.length === 1 ? "host" : "hosts"}
              </span>
            </h3>
            {render(group.nodes)}
          </div>
        ) : (
          <div key="all">{render(group.nodes)}</div>
        ),
      )}
      {!props.nodes.length && (
        <p className="fleet-empty">
          No hosts match these filters. Clear the search or choose another
          status.
        </p>
      )}
    </Section>
  );
}

function lastSeen(node: Node, serverTime: number | null) {
  if (node.last_seen === null) return "Never";
  return relativeAge((serverTime ?? Date.now() / 1000) - node.last_seen);
}

function HostCard({
  node,
  pulse,
  pulseMetric,
  serverTime,
  onOpen,
}: { node: Node } & HostsViewProps) {
  const state = displayState(node);
  const values = pulseSeries(pulse, node.id, pulseMetric);
  return (
    <article className="host-card" data-state={state}>
      <header>
        <button
          type="button"
          className="fleet-host-link"
          onClick={() => onOpen(node.id)}
        >
          {node.name}
        </button>
        <Status value={state} />
      </header>
      <p className="host-card-meta">
        {node.hostname ? (
          <code>{node.hostname}</code>
        ) : (
          <span className="fleet-na">Awaiting agent</span>
        )}
        <span>{node.cluster}</span>
      </p>
      <div className="host-card-bars">
        <MiniBar label="CPU" value={node.metrics.cpu} />
        <MiniBar label="Memory" value={node.metrics.memory} />
        <MiniBar label="GPU" value={node.metrics.gpu} />
      </div>
      <div className="host-card-foot">
        <Sparkline
          values={values}
          label={`${METRIC_LABELS[pulseMetric]} trend for ${node.name}`}
        />
        <dl>
          <div>
            <dt>CI running</dt>
            <dd>{node.metrics.ci_running ?? "No data"}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{lastSeen(node, serverTime)}</dd>
          </div>
        </dl>
      </div>
      {node.notes && (
        <p className="host-card-notes" title={node.notes}>
          {node.notes}
        </p>
      )}
    </article>
  );
}

function HostTable(props: HostsViewProps) {
  return (
    <div className="fleet-table-scroll">
      <table className="host-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = props.sortKey === column.key;
              return (
                <th
                  key={column.key}
                  aria-sort={
                    active
                      ? props.sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => props.onSort(column.key)}
                  >
                    {column.label}
                    {active &&
                      (props.sortDirection === "asc" ? (
                        <ArrowUp size={13} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={13} aria-hidden="true" />
                      ))}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {props.nodes.map((node) => (
            <tr key={node.id}>
              <td>
                <button
                  type="button"
                  className="fleet-host-link"
                  onClick={() => props.onOpen(node.id)}
                >
                  {node.name}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                <small>{node.hostname || "Awaiting agent"}</small>
              </td>
              <td>{node.cluster}</td>
              <td>
                <Status value={displayState(node)} />
              </td>
              <td>{percentText(node.metrics.cpu)}</td>
              <td>{percentText(node.metrics.memory)}</td>
              <td>{percentText(node.metrics.gpu)}</td>
              <td>{node.metrics.ci_running ?? "No data"}</td>
              <td>{lastSeen(node, props.serverTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
