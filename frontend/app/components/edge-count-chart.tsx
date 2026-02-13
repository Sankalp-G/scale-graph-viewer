import { useMemo } from "react";

import { useEdgeResultsStore } from "~/stores/edge-results";

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

export default function EdgeCountChart() {
  const { points } = useEdgeResultsStore();

  const chart = useMemo(() => {
    const width = 280;
    const height = 120;
    const padding = { top: 8, right: 10, bottom: 22, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    if (points.length === 0) {
      return {
        width,
        height,
        path: "",
        area: "",
        maxValue: 0,
        scaleMax: 1,
        yTicks: [0, 1],
        startLabel: "--:--",
        endLabel: "--:--",
        latestTotal: 0,
        padding,
      };
    }

    const totals = points.map((point) => point.total);
    const maxValue = Math.max(0, ...totals);
    const minValue = 0;
    const targetTickCount = 5;
    const step = niceNum(maxValue / (targetTickCount - 1 || 1), true);
    const scaleMax = Math.max(step, Math.ceil(maxValue / step) * step);
    const range = scaleMax - minValue || 1;

    const yTicks: number[] = [];
    for (let value = 0; value <= scaleMax + step / 2; value += step) {
      yTicks.push(value);
    }

    const getX = (index: number) => {
      if (points.length === 1) {
        return padding.left + plotWidth / 2;
      }
      return padding.left + (index / (points.length - 1)) * plotWidth;
    };
    const getY = (value: number) =>
      padding.top + (1 - (value - minValue) / range) * plotHeight;

    let path = "";
    let area = "";
    points.forEach((point, index) => {
      const x = getX(index);
      const y = getY(point.total);
      path += index === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    if (points.length > 0) {
      const startX = getX(0);
      const endX = getX(points.length - 1);
      const baseline = padding.top + plotHeight;
      area = `${path} L ${endX} ${baseline} L ${startX} ${baseline} Z`;
    }

    const startPoint = points[0];
    const endPoint = points[points.length - 1];

    return {
      width,
      height,
      path,
      area,
      maxValue,
      scaleMax,
      yTicks,
      startLabel: formatTimeLabel(startPoint.timestamp, startPoint.receivedAt),
      endLabel: formatTimeLabel(endPoint.timestamp, endPoint.receivedAt),
      latestTotal: totals[totals.length - 1] ?? 0,
      padding,
    };
  }, [points]);

  return (
    <div className="rounded-lg border border-border/60 bg-white p-3 text-slate-900 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Aggregate count
        </p>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {chart.latestTotal}
        </span>
      </div>
      <svg
        className="mt-2 w-full"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Aggregate count over time"
      >
        <text
          x="10"
          y={chart.height / 2}
          fontSize="10"
          fill="currentColor"
          opacity="0.5"
          textAnchor="middle"
          transform={`rotate(-90 10 ${chart.height / 2})`}
        >
          count
        </text>
        {chart.yTicks.map((tick) => {
          const y =
            chart.padding.top +
            (1 - tick / (chart.scaleMax || 1)) *
              (chart.height - chart.padding.top - chart.padding.bottom);
          return (
            <g key={`y-${tick}`}>
              <line
                x1={chart.padding.left}
                x2={chart.width - chart.padding.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={chart.padding.left - 6}
                y={y + 3}
                fontSize="10"
                fill="currentColor"
                opacity="0.6"
                textAnchor="end"
              >
                {formatTickValue(tick)}
              </text>
            </g>
          );
        })}
        {chart.area ? (
          <path d={chart.area} fill="currentColor" opacity="0.08" />
        ) : null}
        {chart.path ? (
          <path
            d={chart.path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            fontSize="12"
            fill="currentColor"
            opacity="0.4"
          >
            Waiting for data
          </text>
        )}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{chart.startLabel}</span>
        <span>time</span>
        <span>{chart.endLabel}</span>
      </div>
    </div>
  );
}
