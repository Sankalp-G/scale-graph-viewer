import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useEdgeResultsStore, type EdgeCountPoint } from "~/stores/edge-results";

type EdgeCountChartProps = {
  points?: EdgeCountPoint[];
  title?: string;
  timeRange?: { startMs: number; endMs: number };
};

const niceNum = (range: number, round: boolean) => {
  if (range <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction = 1;

  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * Math.pow(10, exponent);
};

const formatTimeLabel = (
  timestamp: string | null,
  fallbackMs: number,
  withSeconds = true
) => {
  const date = timestamp ? new Date(timestamp) : new Date(fallbackMs);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
};

const formatTickValue = (value: number) => {
  if (value >= 1000) {
    const rounded = Math.round((value / 1000) * 10) / 10;
    return `${rounded}k`;
  }
  return `${value}`;
};

const MAX_TIME_WINDOW_MS = 600_000;

const getPointTimeMs = (point: EdgeCountPoint) => {
  if (point.timestamp) {
    const parsed = Date.parse(point.timestamp);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return point.receivedAt;
};

export default function EdgeCountChart({
  points: pointsProp,
  title = "Aggregate count",
  timeRange,
}: EdgeCountChartProps) {
  const { points: storePoints } = useEdgeResultsStore();
  const points = pointsProp ?? storePoints;

  const chart = useMemo(() => {
    const height = 120;
    if (points.length === 0) {
      return {
        height,
        maxValue: 0,
        scaleMax: 1,
        yTicks: [0, 1],
        startLabel: "--:--",
        endLabel: "--:--",
        latestTotal: 0,
        data: [],
        windowStart: 0,
        windowEnd: 0,
      };
    }

    const times = points.map((point) => getPointTimeMs(point));
    const baseMinTime = timeRange ? timeRange.startMs : Math.min(...times);
    const baseMaxTime = timeRange ? timeRange.endMs : Math.max(...times);
    const useWindow =
      Number.isFinite(baseMinTime) &&
      Number.isFinite(baseMaxTime) &&
      baseMaxTime - baseMinTime > MAX_TIME_WINDOW_MS;
    const windowEnd = useWindow ? baseMaxTime : baseMaxTime;
    const windowStart = useWindow ? baseMaxTime - MAX_TIME_WINDOW_MS : baseMinTime;

    const windowedPoints = points.filter((point) => {
      const time = getPointTimeMs(point);
      return time >= windowStart && time <= windowEnd;
    });
    const sortedPoints = windowedPoints
      .map((point) => ({ point, timeMs: getPointTimeMs(point) }))
      .filter((entry) => Number.isFinite(entry.timeMs))
      .sort((a, b) => a.timeMs - b.timeMs);
    const totals = sortedPoints.map((entry) => entry.point.total);
    const maxValue = Math.max(0, ...totals);
    const targetTickCount = 5;
    const step = niceNum(maxValue / (targetTickCount - 1 || 1), true);
    const scaleMax = Math.max(step, Math.ceil(maxValue / step) * step);
    const yTicks: number[] = [];
    for (let value = 0; value <= scaleMax + step / 2; value += step) {
      yTicks.push(value);
    }

    const data = sortedPoints.map((entry) => ({
      timeMs: entry.timeMs,
      total: entry.point.total,
    }));
    if (data.length > 0) {
      const first = data[0];
      const last = data[data.length - 1];
      if (first.timeMs > windowStart) {
        data.unshift({ timeMs: windowStart, total: first.total });
      }
      if (last.timeMs < windowEnd) {
        data.push({ timeMs: windowEnd, total: last.total });
      }
    }

    return {
      height,
      maxValue,
      scaleMax,
      yTicks,
      startLabel: formatTimeLabel(null, windowStart),
      endLabel: formatTimeLabel(null, windowEnd),
      latestTotal: totals[totals.length - 1] ?? 0,
      data,
      windowStart,
      windowEnd,
    };
  }, [points, timeRange]);

  return (
    <div className="rounded-lg border border-border/60 bg-white p-3 text-slate-900 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {chart.latestTotal}
        </span>
      </div>
      <div className="mt-2 h-[120px]">
        {chart.data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart.data}>
              <defs>
                <linearGradient id="countFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="currentColor" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="timeMs"
                type="number"
                domain={[chart.windowStart, chart.windowEnd]}
                hide
              />
              <YAxis
                domain={[0, chart.scaleMax]}
                ticks={chart.yTicks}
                tickFormatter={formatTickValue}
                tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  borderColor: "rgba(15, 23, 42, 0.08)",
                }}
                labelFormatter={(value) =>
                  typeof value === "number" ? formatTimeLabel(null, value) : ""
                }
                formatter={(value) => [value, "count"]}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="currentColor"
                strokeWidth={2}
                fill="url(#countFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Waiting for data
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{chart.startLabel}</span>
        <span>time</span>
        <span>{chart.endLabel}</span>
      </div>
    </div>
  );
}
