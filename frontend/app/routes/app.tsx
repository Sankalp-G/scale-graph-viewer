import { useEffect, useMemo, useState } from "react";

import BackgroundMap from "~/welcome/components/background-map";
import ExperimentCard from "~/welcome/components/experiment-card";
import SelectionCard from "~/welcome/components/selection-card";
import type { Route } from "./+types/home";

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
};

const joinUrl = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;

export default function App() {
  const [clearSelectionToken, setClearSelectionToken] = useState(0);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [flowFrame, setFlowFrame] = useState<FlowFeatureCollection>(emptyFlowFrame);
  const [activeTimestamp, setActiveTimestamp] = useState<string | null>(null);
  const [selectedCameras, setSelectedCameras] = useState<string[]>([]);

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
        const res = await fetch(joinUrl(apiBase, "/sample/status"));
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
    const socketUrl = joinUrl(wsBase, "/sample/ws/flow");
    let socket: WebSocket | null = new WebSocket(socketUrl);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as FlowFrameMessage;
        if (payload.frame) {
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
      const res = await fetch(joinUrl(apiBase, "/sample/start"), { method: "POST" });
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
