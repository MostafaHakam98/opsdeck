import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bytes, pct } from "../../lib/api";
import { records, object, number, text, age } from "./format";
import { Status, Table, Section } from "./FleetComponents";
import type { Detail, Point } from "./types";

export function NodeDetail({
  detail,
  history,
  hours,
  onHours,
}: {
  detail: Detail;
  history: Point[];
  hours: number;
  onHours: (hours: number) => void;
}) {
  const sources = detail.sources;
  const host = object(sources.host?.data),
    docker = object(sources.docker?.data),
    runner = object(sources.runner?.data);
  const cpu = object(host.cpu),
    memory = object(host.memory),
    storage = object(docker.storage);
  const [tab, setTab] = useState("Resources");
  return (
    <>
      <div className="fleet-node-heading">
        <div>
          <h1>{detail.node.name}</h1>
          <p>
            {detail.node.cluster} /{" "}
            {detail.node.hostname || "Waiting for hostname"}
          </p>
        </div>
        <Status value={detail.node.status} />
      </div>
      <p className="fleet-context">
        Last observation {age(detail.node.age_seconds)}. Collection scope:{" "}
        {detail.node.scope || "not reported"}.
      </p>
      {detail.node.status !== "online" && (
        <div className="fleet-warning" role="status">
          {detail.node.status === "revoked"
            ? "This agent is revoked. Rotate its credential to reconnect it."
            : detail.node.status === "waiting"
              ? "Start the agent on this host to receive its first observation."
              : "These are retained observations. Check the agent service, outbound connectivity, and host clock."}
        </div>
      )}
      <div className="fleet-source-grid">
        {["host", "docker", "gpu", "runner", "services"].map((key) => (
          <div key={key}>
            <strong>
              {key === "gpu" ? "GPU" : key[0].toUpperCase() + key.slice(1)}
            </strong>
            <Status
              value={
                sources[key]?.stale
                  ? "stale"
                  : sources[key]?.status || "waiting"
              }
            />
            <small>
              {sources[key]?.message ||
                (sources[key]
                  ? `Updated ${age(sources[key].age_seconds)}`
                  : "Waiting for telemetry")}
            </small>
          </div>
        ))}
      </div>
      <nav className="fleet-tabs" aria-label="Host views">
        {["Resources", "Containers", "Runner & services"].map((name) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {tab === "Resources" && (
        <>
          <div className="fleet-capacity">
            <div>
              <span>CPU</span>
              <strong>{pct(number(cpu.percent))}</strong>
              <small>
                {text(cpu.cores)} cores / {text(cpu.threads)} threads
              </small>
            </div>
            <div>
              <span>Memory</span>
              <strong>{pct(number(memory.percent))}</strong>
              <small>
                {bytes(number(memory.used))} of {bytes(number(memory.total))}
              </small>
            </div>
            <div>
              <span>Running CI workers</span>
              <strong>{number(docker.ci_running) ?? "Unavailable"}</strong>
              <small>Observed in this host's Docker engine</small>
            </div>
          </div>
          <Section title="Resource history">
            <div className="fleet-chart-toolbar">
              <span>CPU and memory utilization (%)</span>
              <label>
                Window{" "}
                <select
                  value={hours}
                  onChange={(e) => onHours(Number(e.target.value))}
                >
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={168}>7 days</option>
                </select>
              </label>
            </div>
            {history.length ? (
              <div className="fleet-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid stroke="var(--chart-grid)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) =>
                        new Date(v * 1000).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      }
                      stroke="var(--chart-tick)"
                    />
                    <YAxis domain={[0, 100]} stroke="var(--chart-tick)" />
                    <Tooltip
                      labelFormatter={(v) =>
                        new Date(Number(v) * 1000).toLocaleString()
                      }
                      contentStyle={{
                        background: "var(--surface)",
                        borderColor: "var(--border)",
                      }}
                    />
                    <Line
                      dataKey="cpu"
                      name="CPU"
                      stroke="var(--series-1)"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="memory"
                      name="Memory"
                      stroke="var(--series-2)"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="fleet-empty">
                History will appear after this agent sends telemetry.
              </p>
            )}
          </Section>
          <Section title="Filesystems">
            <Table headings={["Mount", "Device", "Used", "Capacity", "Usage"]}>
              {records(host.volumes).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.mount)}</td>
                  <td>{text(v.device)}</td>
                  <td>{bytes(number(v.used))}</td>
                  <td>{bytes(number(v.total))}</td>
                  <td>{pct(number(v.percent))}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Disk activity">
            <Table headings={["Disk", "Read/s", "Write/s", "IOPS", "Latency"]}>
              {records(host.disks).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{bytes(number(v.read_bytes_s))}</td>
                  <td>{bytes(number(v.write_bytes_s))}</td>
                  <td>{number(v.iops)?.toFixed(1) ?? "Unavailable"}</td>
                  <td>{number(v.await_ms)?.toFixed(1) ?? "Unavailable"} ms</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Network">
            <Table headings={["Interface", "Link", "Receive/s", "Send/s"]}>
              {records(host.network).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{v.up ? "Up" : "Down"}</td>
                  <td>{bytes(number(v.rx_bytes_s))}</td>
                  <td>{bytes(number(v.tx_bytes_s))}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="GPUs">
            <Table
              headings={["Device", "Utilization", "VRAM used", "Temperature"]}
            >
              {records(sources.gpu?.data).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{pct(number(v.utilization))}</td>
                  <td>
                    {bytes(
                      number(v.memory_used_mib) === null
                        ? null
                        : v.memory_used_mib * 1024 * 1024,
                    )}
                  </td>
                  <td>{text(v.temperature)} °C</td>
                </tr>
              ))}
            </Table>
            {!records(sources.gpu?.data).length && (
              <p className="fleet-empty">
                No GPU telemetry reported by this agent.
              </p>
            )}
          </Section>
          <Section title="Top processes by memory">
            <Table headings={["Process", "PID", "Memory"]}>
              {records(host.top_processes).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{text(v.pid)}</td>
                  <td>{bytes(number(v.memory_bytes))}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
      {tab === "Containers" && (
        <>
          <Section title="Containers">
            <Table
              headings={[
                "Container",
                "Image",
                "State",
                "CPU",
                "Memory",
                "CI job",
              ]}
            >
              {records(docker.containers).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{text(v.image)}</td>
                  <td>{text(v.state)}</td>
                  <td>{pct(number(v.cpu_percent))}</td>
                  <td>{bytes(number(v.memory_bytes))}</td>
                  <td>{text(object(v.ci_metadata).job_id)}</td>
                </tr>
              ))}
            </Table>
            {!records(docker.containers).length && (
              <p className="fleet-empty">
                No containers reported. Check the Docker source status above.
              </p>
            )}
          </Section>
          <Section title="Images and build cache">
            <p className="fleet-context">
              Build cache {bytes(number(storage.build_cache_bytes))};
              reclaimable {bytes(number(storage.build_cache_reclaimable_bytes))}
              .
            </p>
            <Table headings={["Image", "Size", "Referencing containers"]}>
              {records(docker.images).map((v, i) => (
                <tr key={i}>
                  <td>
                    {Array.isArray(v.tags) && v.tags.length
                      ? v.tags.map(text).join(", ")
                      : text(v.id)}
                  </td>
                  <td>{bytes(number(v.size_bytes))}</td>
                  <td>{text(v.referencing_containers)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
      {tab === "Runner & services" && (
        <>
          <Section title="Runner configuration">
            <Table
              headings={["Runner", "Executor", "Limit", "Request concurrency"]}
            >
              {records(object(runner.facts).runners).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{text(v.executor)}</td>
                  <td>{text(v.limit)}</td>
                  <td>{text(v.request_concurrency)}</td>
                </tr>
              ))}
            </Table>
            <p className="fleet-context">
              Host concurrency: {text(object(runner.facts).concurrent)}. Runner
              credentials are excluded from telemetry.
            </p>
          </Section>
          <Section title="Runner metrics">
            <Table headings={["Metric", "Value"]}>
              {Object.entries(object(runner.metrics)).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{text(value)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Services">
            <Table headings={["Service", "State", "Substate"]}>
              {records(sources.services?.data).map((v, i) => (
                <tr key={i}>
                  <td>{text(v.name)}</td>
                  <td>{text(v.state)}</td>
                  <td>{text(v.substate)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
    </>
  );
}
