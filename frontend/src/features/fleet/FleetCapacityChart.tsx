import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FleetPoint } from "./types";

function tick(seconds: number, hours: number) {
  return new Date(seconds * 1000).toLocaleString(
    [],
    hours > 24
      ? { month: "short", day: "numeric" }
      : { hour: "2-digit", minute: "2-digit" },
  );
}
const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
};
const axis = {
  stroke: "var(--chart-tick)",
  tick: { fill: "var(--chart-tick)", fontSize: 12 },
  tickLine: false,
};

/** Fleet utilization (one 0..100 axis) above a separate CI workload chart. */
export default function FleetCapacityChart({
  points,
  hours,
}: {
  points: FleetPoint[];
  hours: number;
}) {
  const xAxis = (
    <XAxis
      dataKey="ts"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      tickFormatter={(v) => tick(Number(v), hours)}
      minTickGap={36}
      {...axis}
    />
  );
  const label = (v: unknown) => new Date(Number(v) * 1000).toLocaleString();
  return (
    <div className="fleet-capacity-charts">
      <ul className="fleet-chart-legend">
        <li>
          <i className="swatch-cpu" />
          CPU average
        </li>
        <li>
          <i className="swatch-cpu dashed" />
          CPU peak
        </li>
        <li>
          <i className="swatch-memory" />
          Memory average
        </li>
        <li>
          <i className="swatch-memory dashed" />
          Memory peak
        </li>
      </ul>
      <div className="fleet-chart fleet-chart-main">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, left: -12 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            {xAxis}
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              unit="%"
              {...axis}
            />
            <Tooltip
              labelFormatter={label}
              formatter={(value) =>
                typeof value === "number" ? `${value.toFixed(1)}%` : "No data"
              }
              contentStyle={tooltipStyle}
            />
            <Area
              dataKey="cpu"
              name="CPU average"
              stroke="var(--series-1)"
              fill="var(--series-1)"
              fillOpacity={0.14}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="cpu_peak"
              name="CPU peak"
              stroke="var(--series-1)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="memory"
              name="Memory average"
              stroke="var(--series-2)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="memory_peak"
              name="Memory peak"
              stroke="var(--series-2)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <h3 className="fleet-chart-subtitle">CI jobs running across the fleet</h3>
      <div className="fleet-chart fleet-chart-ci">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, left: -12 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            {xAxis}
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip
              labelFormatter={label}
              formatter={(value) =>
                typeof value === "number" ? value.toFixed(1) : "No data"
              }
              contentStyle={tooltipStyle}
            />
            <Area
              dataKey="ci_running"
              name="CI jobs running"
              stroke="var(--series-3)"
              fill="var(--series-3)"
              fillOpacity={0.14}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
