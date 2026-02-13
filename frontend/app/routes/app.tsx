import { useEffect, useMemo, useRef, useState } from "react";

import BackgroundMap from "~/welcome/components/background-map";
import ExperimentCard from "~/welcome/components/experiment-card";
import SelectionCard from "~/welcome/components/selection-card";
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

type EdgeResult = {
  edge_id: string;
  count: number;
  classification: number;
};

type FlowFrameMessage = {
  timestamp?: string | null;
  frame?: FlowFeatureCollection;
  edge_results?: EdgeResult[];
};

const joinUrl = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;

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
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [flowFrame, setFlowFrame] = useState<FlowFeatureCollection>(emptyFlowFrame);
  const [activeTimestamp, setActiveTimestamp] = useState<string | null>(null);
  const [selectedCameras, setSelectedCameras] = useState<string[]>([]);
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
          setStatus(data.status);
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
    if (status !== "inprogress") {
      setFlowFrame(emptyFlowFrame);
      setActiveTimestamp(null);
    }
  }, [status]);

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
          const geometryMap = geometryMapRef.current;
          if (geometryMap) {
            setFlowFrame(buildFlowFrame(payload.edge_results, geometryMap));
          } else {
            pendingEdgeResultsRef.current = payload.edge_results;
          }
        } else if (payload.frame) {
          setFlowFrame(payload.frame);
        }
        if (payload.timestamp !== undefined) {
          setActiveTimestamp(payload.timestamp ?? null);
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

  const handleStart = async () => {
    if (status === "inprogress") {
      return;
    }
    try {
      const res = await fetch(joinUrl(apiBase, "/app/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          selectedCameras.length > 0
            ? JSON.stringify({ camera_names: selectedCameras })
            : undefined,
      });
      const data = (await res.json()) as { status?: StreamStatus };
      if (data.status === "idle" || data.status === "inprogress") {
        setStatus(data.status);
      }
    } catch (error) {
      console.error("Failed to start stream", error);
    }
  };

  return (
    <main className="relative min-h-screen text-black bg-transparent">
      <div className="fixed left-6 top-6 z-10 flex w-full max-w-xs flex-col gap-3">
        <ExperimentCard
          status={status}
          activeTimestamp={activeTimestamp}
          onStart={handleStart}
        />
        <SelectionCard
          selected={selectedCameras}
          disabled={status === "inprogress"}
          onClearSelection={() => {
            if (status === "inprogress") {
              return;
            }
            setClearSelectionToken((t) => t + 1);
            setSelectedCameras([]);
          }}
        />
      </div>
      <BackgroundMap
        clearSelectionToken={clearSelectionToken}
        flowFrame={flowFrame}
        selectionEnabled={status !== "inprogress"}
        onSelectionChange={(names) => {
          if (status !== "inprogress") {
            setSelectedCameras(names);
          }
        }}
      />
    </main>
  );
}
