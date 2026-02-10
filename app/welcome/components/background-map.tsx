import { useEffect, useRef, useState } from "react";
import mapboxgl from 'mapbox-gl';

type CameraPoint = {
  name: string;
  latitude: number;
  longitude: number;
};

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

type BackgroundMapProps = {
  onSelectionChange?: (names: string[]) => void;
  clearSelectionToken?: number;
  flowFrame?: FlowFeatureCollection;
};

export default function BackgroundMap({
  onSelectionChange,
  clearSelectionToken,
  flowFrame,
}: BackgroundMapProps) {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const camerasRef = useRef<CameraPoint[]>([]);
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const startPointRef = useRef<mapboxgl.Point | null>(null);
  const lastClearTokenRef = useRef<number | undefined>(undefined);
  const pendingFlowFrameRef = useRef<FlowFeatureCollection | null>(null);

  const parseCameraCsv = (csvText: string): CameraPoint[] => {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split(",").map((h) => h.replace(/^\uFEFF/, "").trim());
    const cameraIndex = headers.indexOf("camera");
    const latIndex = headers.indexOf("latitude");
    const lonIndex = headers.indexOf("longitude");
    if (cameraIndex < 0 || latIndex < 0 || lonIndex < 0) {
      return [];
    }

    const cameras: CameraPoint[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      if (cols.length <= Math.max(cameraIndex, latIndex, lonIndex)) {
        continue;
      }
      const latitude = Number(cols[latIndex]);
      const longitude = Number(cols[lonIndex]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }
      const name = cols[cameraIndex].trim();
      if (!name) {
        continue;
      }
      cameras.push({ name, latitude, longitude });
    }
    return cameras;
  };

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    const map = new mapboxgl.Map({
	    container: 'map',
	    style: 'mapbox://styles/mapbox/streets-v12',
      center: [77.5997, 12.9717],
      zoom: 14,
      scrollZoom: false,
      boxZoom: false,
      doubleClickZoom: false,
      keyboard: false,
      touchZoomRotate: false,
      dragRotate: false,
      dragPan: false,
    });

    const ensureSelectionBox = () => {
      if (selectionBoxRef.current) {
        return selectionBoxRef.current;
      }
      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.border = "2px dashed #333333";
      box.style.background = "rgba(0, 0, 0, 0.1)";
      box.style.pointerEvents = "none";
      box.style.display = "none";
      selectionBoxRef.current = box;
      map.getCanvasContainer().appendChild(box);
      return box;
    };

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      const start = startPointRef.current;
      if (!start) {
        return;
      }
      const box = ensureSelectionBox();
      const current = e.point;
      const minX = Math.min(start.x, current.x);
      const maxX = Math.max(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxY = Math.max(start.y, current.y);
      box.style.left = `${minX}px`;
      box.style.top = `${minY}px`;
      box.style.width = `${maxX - minX}px`;
      box.style.height = `${maxY - minY}px`;
    };

    const finishSelection = (e: mapboxgl.MapMouseEvent) => {
      const start = startPointRef.current;
      if (!start) {
        return;
      }
      startPointRef.current = null;
      map.off("mousemove", onMouseMove);

      const box = ensureSelectionBox();
      box.style.display = "none";

      const end = e.point;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      const sw = map.unproject([minX, maxY]);
      const ne = map.unproject([maxX, minY]);
      const minLng = Math.min(sw.lng, ne.lng);
      const maxLng = Math.max(sw.lng, ne.lng);
      const minLat = Math.min(sw.lat, ne.lat);
      const maxLat = Math.max(sw.lat, ne.lat);

      const selected = camerasRef.current
        .filter(
          (camera) =>
            camera.longitude >= minLng &&
            camera.longitude <= maxLng &&
            camera.latitude >= minLat &&
            camera.latitude <= maxLat
        )
        .map((camera) => camera.name);

      console.log("Selected cameras:", selected);
      onSelectionChange?.(selected);

      if (map.getLayer("cameras_selected_layer")) {
        const filter =
          selected.length > 0
            ? (["in", "camera", ...selected] as mapboxgl.Filter)
            : (["==", "camera", "__none__"] as mapboxgl.Filter);
        map.setFilter("cameras_selected_layer", filter);
      }
    };

    const onMouseDown = (e: mapboxgl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) {
        return;
      }
      e.preventDefault();
      startPointRef.current = e.point;
      const box = ensureSelectionBox();
      box.style.display = "block";
      box.style.left = `${e.point.x}px`;
      box.style.top = `${e.point.y}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      map.on("mousemove", onMouseMove);
      map.once("mouseup", finishSelection);
      map.once("mouseout", finishSelection);
    };

    map.on("mousedown", onMouseDown);

    fetch("/sample_camera_edges/camera_node_mapping.csv")
      .then((res) => res.text())
      .then((text) => {
        camerasRef.current = parseCameraCsv(text);
      })
      .catch((err) => {
        console.error("Failed to load camera CSV", err);
      });

    map.on('load', () => {
      map.addSource('non_internal_edges', {
        type: 'geojson',
        generateId: true,
        data: '/sample_camera_edges/edges_non_internal.geojson',
      });

      map.addLayer({
        id: 'non_internal_edges_layer',
        type: 'line',
        source: 'non_internal_edges',
        paint: {
          'line-color': '#264653',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7],
          'line-opacity': 0.5,
          'line-blur': 0.4,
        },
      });

      map.addSource('flow_edges', {
        type: 'geojson',
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: 'flow_edges_layer',
        type: 'line',
        source: 'flow_edges',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'value'],
            1,
            '#f4a261',
            2,
            '#e63946',
            '#94a3b8',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7],
          'line-opacity': [
            'match',
            ['get', 'value'],
            0,
            0,
            1,
            1,
            2,
            1,
            0.5,
          ],
          'line-blur': 0.6,
        },
      });

      map.addSource('junctions', {
        type: 'geojson',
        generateId: true,
        data: '/sample_camera_edges/junctions.geojson',
      });

      map.addLayer({
        id: 'junctions_layer',
        type: 'circle',
        source: 'junctions',
        paint: {
          'circle-color': '#2a9d8f',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 2.4, 17, 4],
          'circle-opacity': 0.35,
          'circle-stroke-color': '#0f2b2c',
          'circle-stroke-width': 0.5,
        },
      });

      map.addSource('cameras', {
        type: 'geojson',
        generateId: true,
        data: '/sample_camera_edges/cameras.geojson',
      });

      map.addLayer({
        id: 'cameras_layer',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-color': '#e63946',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 5, 17, 7],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#3a0a0f',
          'circle-stroke-width': 0.8,
        },
      });

      map.addLayer({
        id: 'cameras_selected_layer',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-color': '#ffb703',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7.5, 17, 8],
          'circle-opacity': 0.95,
          'circle-stroke-color': '#1b1b1b',
          'circle-stroke-width': 1.0,
        },
        filter: ["==", "camera", "__none__"],
      });

      if (pendingFlowFrameRef.current) {
        const source = map.getSource("flow_edges") as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(pendingFlowFrameRef.current);
          pendingFlowFrameRef.current = null;
        }
      }
    });

    setMap(map);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      if (selectionBoxRef.current) {
        selectionBoxRef.current.remove();
        selectionBoxRef.current = null;
      }
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!map || clearSelectionToken === undefined) {
      return;
    }
    if (lastClearTokenRef.current === clearSelectionToken) {
      return;
    }
    lastClearTokenRef.current = clearSelectionToken;
    if (map.getLayer("cameras_selected_layer")) {
      map.setFilter("cameras_selected_layer", ["==", "camera", "__none__"]);
    }
    onSelectionChange?.([]);
  }, [map, clearSelectionToken, onSelectionChange]);

  useEffect(() => {
    if (!map || !flowFrame) {
      return;
    }
    const source = map.getSource("flow_edges") as mapboxgl.GeoJSONSource | undefined;
    if (!source) {
      pendingFlowFrameRef.current = flowFrame;
      return;
    }
    source.setData(flowFrame);
  }, [map, flowFrame]);

  console.log(map);

  // print coords
  console.log(map && map.getCenter());

  return (
    <div className="absolute inset-0 z-0">
      <div className="h-full w-full" id="map"></div>
    </div>
  );
}
