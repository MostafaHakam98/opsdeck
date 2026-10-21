/**
 * Shared Recharts styling so every chart reads the same in both themes:
 * token colors only, no axis lines, quiet grid, one tooltip surface.
 */
export const chartTick = {
  fill: "var(--chart-tick)",
  fontSize: 11,
  fontFamily: "var(--font-body)",
};
export const chartTooltip = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    boxShadow: "var(--shadow-lg)",
    color: "var(--text)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { color: "var(--text-muted)", marginBottom: 4 },
  itemStyle: { padding: "1px 0" },
  cursor: { stroke: "var(--border-strong)", strokeWidth: 1 },
};
export const barCursor = { fill: "var(--surface-3)", opacity: 0.6 };
export const axisProps = {
  tick: chartTick,
  axisLine: false,
  tickLine: false,
} as const;
export const gridProps = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "0",
} as const;
export const activeDot = {
  r: 3.5,
  strokeWidth: 2,
  stroke: "var(--surface)",
} as const;

/**
 * Dots keep sparse or gappy series honest: every point is drawn when the
 * series is short, otherwise only points with no measured neighbour (which a
 * line with gaps could not show at all).
 */
export function gapDots(
  data: Array<Record<string, any>>,
  key: string,
  color: string,
) {
  if (data.length <= 60) return { r: 2, strokeWidth: 0, fill: color };
  return (props: any) => {
    const i = props.index as number;
    const isolated =
      props.payload?.[key] != null &&
      data[i - 1]?.[key] == null &&
      data[i + 1]?.[key] == null;
    return isolated ? (
      <circle
        key={`dot-${i}`}
        className="recharts-dot recharts-line-dot"
        cx={props.cx}
        cy={props.cy}
        r={2}
        fill={color}
      />
    ) : (
      <g key={`dot-${i}`} />
    );
  };
}
