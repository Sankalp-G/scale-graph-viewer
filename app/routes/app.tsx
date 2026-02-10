import { useEffect, useState } from "react";

import BackgroundMap from "~/welcome/components/background-map";
import ExperimentCard from "~/welcome/components/experiment-card";
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

type EdgeGeometryFeature = {
  type: "Feature";
  geometry: LineStringGeometry;
  properties: {
    edge_id: string;
    [key: string]: unknown;
  };
};

type EdgeGeometryCollection = {
  type: "FeatureCollection";
  features: EdgeGeometryFeature[];
};

type FlowRow = {
  edgeId: string;
  values: number[];
};

type FlowData = {
  timestamps: string[];
  rows: FlowRow[];
};

const emptyFlowFrame: FlowFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const normalizeEdgeId = (edgeId: string) => {
  const trimmed = edgeId.trim().replace(/^\uFEFF/, "");
  if (!trimmed) {
    return "";
  }
  const match = trimmed.match(/^(\d+)\.0(#.*)?$/);
  if (match) {
    return match[1] + (match[2] ?? "");
  }
  return trimmed;
};

const parseFlowCsv = (csvText: string): FlowData => {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { timestamps: [], rows: [] };
  }
  const header = lines[0].split(",").map((entry) => entry.trim());
  const timestamps = header.slice(1);
  const rows: FlowRow[] = [];

  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols.length < 2) {
      continue;
    }
    const edgeId = normalizeEdgeId(cols[0]);
    if (!edgeId) {
      continue;
    }
    const values = timestamps.map((_, idx) => Number(cols[idx + 1] ?? 0));
    rows.push({ edgeId, values });
  }

  return { timestamps, rows };
};

const buildGeometryMap = (geojson: EdgeGeometryCollection) => {
  const map = new Map<string, LineStringGeometry>();
  for (const feature of geojson.features) {
    const edgeId = normalizeEdgeId(feature.properties.edge_id);
    if (!edgeId) {
      continue;
    }
    map.set(edgeId, feature.geometry);
  }
  return map;
};

const buildFlowFrame = (
  index: number,
  flowData: FlowData,
  geometryMap: Map<string, LineStringGeometry>
): FlowFeatureCollection => {
  const features: FlowFeature[] = [];
  for (const row of flowData.rows) {
    const geometry = geometryMap.get(row.edgeId);
    if (!geometry) {
      continue;
    }
    const value = row.values[index] ?? 0;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        edge_id: row.edgeId,
        value,
      },
    });
  }
  return { type: "FeatureCollection", features };
};

export default function App() {
  const [clearSelectionToken, setClearSelectionToken] = useState(0);
  const [status, setStatus] = useState<"idle" | "inprogress">("idle");
  const [flowData, setFlowData] = useState<FlowData | null>(null);
  const [geometryMap, setGeometryMap] = useState<Map<string, LineStringGeometry> | null>(
    null
  );
  const [flowFrame, setFlowFrame] = useState<FlowFeatureCollection>(emptyFlowFrame);
  const [activeTimestamp, setActiveTimestamp] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [edgesRes, flowRes] = await Promise.all([
          fetch("/sample_camera_edges/edges_non_internal.geojson"),
          fetch("/sample_camera_edges/edge_flow_component_classes.csv"),
        ]);
        const edgesJson = (await edgesRes.json()) as EdgeGeometryCollection;
        const flowCsv = await flowRes.text();
        if (cancelled) {
          return;
        }
        setGeometryMap(buildGeometryMap(edgesJson));
        setFlowData(parseFlowCsv(flowCsv));
      } catch (error) {
        console.error("Failed to load flow data", error);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "inprogress" || !flowData || !geometryMap) {
      setFlowFrame(emptyFlowFrame);
      setActiveTimestamp(null);
      return;
    }

    let index = 0;
    const total = flowData.timestamps.length;

    const updateFrame = () => {
      setFlowFrame(buildFlowFrame(index, flowData, geometryMap));
      setActiveTimestamp(flowData.timestamps[index] ?? null);
    };

    updateFrame();

    const timer = window.setInterval(() => {
      index = total > 0 ? (index + 1) % total : 0;
      updateFrame();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status, flowData, geometryMap]);

  return (
    <main className="relative min-h-screen text-black bg-transparent">
      <div className="fixed left-6 top-6 z-10">
        <ExperimentCard
          status={status}
          activeTimestamp={activeTimestamp}
          onStart={() => setStatus("inprogress")}
          onClearSelection={() => setClearSelectionToken((t) => t + 1)}
        />
      </div>
      <BackgroundMap clearSelectionToken={clearSelectionToken} flowFrame={flowFrame} />
    </main>
  );
}
