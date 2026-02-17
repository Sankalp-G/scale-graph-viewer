import { useEffect, useMemo, useRef, useState } from "react";

import BackgroundMap from "~/welcome/components/background-map";
import EdgeCountChart from "~/components/edge-count-chart";
import ExperimentCard from "~/welcome/components/experiment-card";
import SelectionCard from "~/welcome/components/selection-card";
import {
  type EdgeCountPoint,
  type EdgeResult,
} from "~/stores/edge-results";
import type { Route } from "./+types/app";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Graph Pipeline viewer" },
    { name: "description", content: "Graph Pipeline viewer" },
  ];
}

type LineStringGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

type FlowFeature = {
  type: "Feature";
  geometry: LineStringGeometry;
  properties: {
    edge_id: string;
    value: number;
    count?: number;
  };
};

type FlowFeatureCollection = {
  type: "FeatureCollection";
  features: FlowFeature[];
};

const emptyFlowFrame: FlowFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

type StreamStatus = "idle" | "inprogress";

type FlowFrameMessage = {
  timestamp?: string | null;
  frame?: FlowFeatureCollection;
  edge_results?: EdgeResult[];
};

const joinUrl = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;

const MAX_POINTS = 180;

const normalizeEdgeId = (edgeId: unknown) => {
  if (edgeId === null || edgeId === undefined) {
    return "";
  }
  const text = String(edgeId).replace(/^\uFEFF/, "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^(\d+)\.0(#.*)?$/);
  if (match) {
    return `${match[1]}${match[2] ?? ""}`;
  }
  return text;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildCountPoint = (
  edgeResults: EdgeResult[],
  timestamp?: string | null
): EdgeCountPoint => {
  const totalCount = edgeResults.reduce((sum, result) => sum + toNumber(result.count), 0);
  return {
    timestamp: timestamp ?? null,
    total: totalCount,
    receivedAt: Date.now(),
  };
};

const appendPoint = (points: EdgeCountPoint[], nextPoint: EdgeCountPoint) =>
  [...points, nextPoint].slice(-MAX_POINTS);

const getPointTimeMs = (point: EdgeCountPoint) => {
  if (point.timestamp) {
    const parsed = Date.parse(point.timestamp);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return point.receivedAt;
};

const getLatestTimestamp = (
  nowcastingPoints: EdgeCountPoint[],
  forecastingPoints: EdgeCountPoint[]
) => {
  let latest: EdgeCountPoint | null = null;
  const visit = (points: EdgeCountPoint[]) => {
    for (const point of points) {
      const time = getPointTimeMs(point);
      if (!Number.isFinite(time)) {
        continue;
      }
      if (!latest || time > getPointTimeMs(latest)) {
        latest = point;
      }
    }
  };
  visit(nowcastingPoints);
  visit(forecastingPoints);
  if (!latest) {
    return null;
  }
  return latest.timestamp ?? new Date(latest.receivedAt).toISOString();
};

const buildTimeRange = (
  nowcastingPoints: EdgeCountPoint[],
  forecastingPoints: EdgeCountPoint[]
) => {
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  const visit = (points: EdgeCountPoint[]) => {
    for (const point of points) {
      const time = getPointTimeMs(point);
      if (!Number.isFinite(time)) {
        continue;
      }
      minTime = Math.min(minTime, time);
      maxTime = Math.max(maxTime, time);
    }
  };
  visit(nowcastingPoints);
  visit(forecastingPoints);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    return null;
  }
  return { startMs: minTime, endMs: maxTime };
};

const buildFlowFrame = (
  edgeResults: EdgeResult[],
  geometryMap: Map<string, LineStringGeometry>
): FlowFeatureCollection => {
  const features: FlowFeature[] = [];
  for (const result of edgeResults) {
    const edgeId = normalizeEdgeId(result.edge_id);
    if (!edgeId) {
      continue;
    }
    const geometry = geometryMap.get(edgeId);
    if (!geometry) {
      continue;
    }
    const value = Number(result.classification ?? 0);
    const count = Number(result.count ?? 0);
    features.push({
      type: "Feature",
      geometry,
      properties: {
        edge_id: edgeId,
        value: Number.isFinite(value) ? value : 0,
        count: Number.isFinite(count) ? count : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
};

export default function App() {
  const [clearSelectionToken, setClearSelectionToken] = useState(0);
  const [nowcastingStatus, setNowcastingStatus] = useState<StreamStatus>("idle");
  const [forecastingStatus, setForecastingStatus] = useState<StreamStatus>("idle");
  const [flowFrame, setFlowFrame] = useState<FlowFeatureCollection>(emptyFlowFrame);
  const [selectedCameras, setSelectedCameras] = useState<string[]>([]);
  const [nowcastingPoints, setNowcastingPoints] = useState<EdgeCountPoint[]>([]);
  const [forecastingPoints, setForecastingPoints] = useState<EdgeCountPoint[]>([]);
  const geometryMapRef = useRef<Map<string, LineStringGeometry> | null>(null);
  const pendingEdgeResultsRef = useRef<EdgeResult[] | null>(null);

  const apiBase = useMemo(
    () => import.meta.env.VITE_BACKEND_HTTP_URL ?? "http://localhost:8000",
    []
  );
  const wsBase = useMemo(
    () => import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8000",
    []
  );

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(joinUrl(apiBase, "/app/status"));
        const data = (await res.json()) as { status?: StreamStatus };
        if (!cancelled && (data.status === "idle" || data.status === "inprogress")) {
          setNowcastingStatus(data.status);
        }
      } catch (error) {
        console.error("Failed to fetch stream status", error);
      }
    };
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(joinUrl(apiBase, "/forecast/status"));
        const data = (await res.json()) as { status?: StreamStatus };
        if (!cancelled && (data.status === "idle" || data.status === "inprogress")) {
          setForecastingStatus(data.status);
        }
      } catch (error) {
        console.error("Failed to fetch forecast status", error);
      }
    };
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (nowcastingStatus !== "inprogress") {
      setFlowFrame(emptyFlowFrame);
      setNowcastingPoints([]);
    }
  }, [nowcastingStatus]);

  useEffect(() => {
    if (forecastingStatus !== "inprogress") {
      setForecastingPoints([]);
    }
  }, [forecastingStatus]);

  useEffect(() => {
    let cancelled = false;
    const loadGeometry = async () => {
      try {
        const res = await fetch("/sample_camera_edges/edges_non_internal.geojson");
        const data = (await res.json()) as {
          features?: Array<{
            geometry?: LineStringGeometry;
            properties?: { edge_id?: string };
          }>;
        };
        if (cancelled) {
          return;
        }
        const geometryMap = new Map<string, LineStringGeometry>();
        for (const feature of data.features ?? []) {
          if (!feature?.geometry || feature.geometry.type !== "LineString") {
            continue;
          }
          const edgeId = normalizeEdgeId(feature.properties?.edge_id);
          if (!edgeId) {
            continue;
          }
          geometryMap.set(edgeId, feature.geometry);
        }
        geometryMapRef.current = geometryMap;
        if (pendingEdgeResultsRef.current) {
          setFlowFrame(buildFlowFrame(pendingEdgeResultsRef.current, geometryMap));
          pendingEdgeResultsRef.current = null;
        }
      } catch (error) {
        console.error("Failed to load edge geometry", error);
      }
    };
    loadGeometry();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socketUrl = joinUrl(wsBase, "/app/ws/flow");
    let socket: WebSocket | null = new WebSocket(socketUrl);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as FlowFrameMessage;
        if (payload.edge_results !== undefined) {
          const point = buildCountPoint(payload.edge_results, payload.timestamp);
          setNowcastingPoints((prev) => appendPoint(prev, point));
          const geometryMap = geometryMapRef.current;
          if (geometryMap) {
            setFlowFrame(buildFlowFrame(payload.edge_results, geometryMap));
          } else {
            pendingEdgeResultsRef.current = payload.edge_results;
          }
        } else if (payload.frame) {
          setFlowFrame(payload.frame);
        }
      } catch (error) {
        console.error("Failed to parse flow frame message", error);
      }
    };

    socket.onclose = () => {
      socket = null;
    };

    socket.onerror = () => {
      socket?.close();
    };

    return () => {
      socket?.close();
    };
  }, [wsBase]);

  useEffect(() => {
    const socketUrl = joinUrl(wsBase, "/forecast/ws/flow");
    let socket: WebSocket | null = new WebSocket(socketUrl);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as FlowFrameMessage;
        if (payload.edge_results !== undefined) {
          const point = buildCountPoint(payload.edge_results, payload.timestamp);
          setForecastingPoints((prev) => appendPoint(prev, point));
        }
      } catch (error) {
        console.error("Failed to parse forecast frame message", error);
      }
    };

    socket.onclose = () => {
      socket = null;
    };

    socket.onerror = () => {
      socket?.close();
    };

    return () => {
      socket?.close();
    };
  }, [wsBase]);

  const handleStart = async () => {
    if (nowcastingStatus === "inprogress" || forecastingStatus === "inprogress") {
      return;
    }
    try {
      const payload =
        selectedCameras.length > 0
          ? JSON.stringify({ camera_names: selectedCameras })
          : undefined;
      const [nowcastingRes, forecastingRes] = await Promise.all([
        fetch(joinUrl(apiBase, "/app/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }),
        fetch(joinUrl(apiBase, "/forecast/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }),
      ]);
      const nowcastingData = (await nowcastingRes.json()) as { status?: StreamStatus };
      const forecastingData = (await forecastingRes.json()) as { status?: StreamStatus };
      if (nowcastingData.status === "idle" || nowcastingData.status === "inprogress") {
        setNowcastingStatus(nowcastingData.status);
      }
      if (forecastingData.status === "idle" || forecastingData.status === "inprogress") {
        setForecastingStatus(forecastingData.status);
      }
    } catch (error) {
      console.error("Failed to start streams", error);
    }
  };

  const combinedStatus =
    nowcastingStatus === "inprogress" || forecastingStatus === "inprogress"
      ? "inprogress"
      : "idle";
  const activeTimestamp = useMemo(
    () => getLatestTimestamp(nowcastingPoints, forecastingPoints),
    [nowcastingPoints, forecastingPoints]
  );
  const timeRange = useMemo(
    () => buildTimeRange(nowcastingPoints, forecastingPoints),
    [nowcastingPoints, forecastingPoints]
  );

  return (
    <main className="relative min-h-screen text-black bg-transparent">
      <div className="fixed left-6 top-6 z-10 flex w-full max-w-xs flex-col gap-3">
        <ExperimentCard
          status={combinedStatus}
          activeTimestamp={activeTimestamp}
          onStart={handleStart}
        />
        <SelectionCard
          selected={selectedCameras}
          disabled={combinedStatus === "inprogress"}
          onClearSelection={() => {
            if (combinedStatus === "inprogress") {
              return;
            }
            setClearSelectionToken((t) => t + 1);
            setSelectedCameras([]);
          }}
        />
        <EdgeCountChart
          title="Nowcasting"
          points={nowcastingPoints}
          timeRange={timeRange ?? undefined}
          lineColor="#2563eb"
        />
        <EdgeCountChart
          title="Forecasting"
          points={forecastingPoints}
          timeRange={timeRange ?? undefined}
          lineColor="#14b8a6"
        />
      </div>
      <BackgroundMap
        clearSelectionToken={clearSelectionToken}
        flowFrame={flowFrame}
        selectionEnabled={combinedStatus !== "inprogress"}
        onSelectionChange={(names) => {
          if (combinedStatus !== "inprogress") {
            setSelectedCameras(names);
          }
        }}
      />
    </main>
  );
}
