#!/usr/bin/env python3
import csv
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent

NET_FILE = ROOT / "network_graph.net.xml"
CAMERA_FILE = ROOT / "camera_node_mapping.csv"
EDGE_FLOW_COMPONENT_FILE = ROOT / "edge_flow_component_classes.csv"

OUT_CAMERAS_GEOJSON = ROOT / "cameras.geojson"
OUT_EDGES_GEOJSON = ROOT / "edges.geojson"
OUT_NON_INTERNAL_EDGES_GEOJSON = ROOT / "edges_non_internal.geojson"
OUT_JUNCTIONS_GEOJSON = ROOT / "junctions.geojson"
OUT_CAMERA_EDGE_MAP = ROOT / "camera_edge_mapping.csv"


def normalize_edge_id(edge_id: str) -> str | None:
    if edge_id is None:
        return None
    edge_id = edge_id.strip().lstrip("\ufeff")
    if not edge_id:
        return None
    m = re.match(r"^(\d+)\.0(#.*)?$", edge_id)
    if m:
        return m.group(1) + (m.group(2) or "")
    return edge_id


# UTM to lat/lon (WGS84)
def utm_to_latlon(easting, northing, zone, northern=True):
    a = 6378137.0
    f = 1 / 298.257223563
    e2 = f * (2 - f)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    k0 = 0.9996

    x = easting - 500000.0
    y = northing
    if not northern:
        y -= 10000000.0

    M = y / k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )

    eprime2 = e2 / (1 - e2)
    C1 = eprime2 * (math.cos(phi1) ** 2)
    T1 = math.tan(phi1) ** 2
    N1 = a / math.sqrt(1 - e2 * (math.sin(phi1) ** 2))
    R1 = a * (1 - e2) / ((1 - e2 * (math.sin(phi1) ** 2)) ** 1.5)
    D = x / (N1 * k0)

    lat = phi1 - (N1 * math.tan(phi1) / R1) * (
        D**2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1**2 - 9 * eprime2) * D**4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1**2 - 252 * eprime2 - 3 * C1**2)
        * D**6
        / 720
    )

    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    lon = lon0 + (
        D
        - (1 + 2 * T1 + C1) * D**3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1**2 + 8 * eprime2 + 24 * T1**2)
        * D**5
        / 120
    ) / math.cos(phi1)

    return math.degrees(lat), math.degrees(lon)


def parse_shape(shape_str: str):
    pts = []
    for part in shape_str.strip().split():
        if not part:
            continue
        x_str, y_str = part.split(",")
        pts.append((float(x_str), float(y_str)))
    return pts


# Load network
root = ET.parse(NET_FILE).getroot()
loc = root.find("location")
net_offset = (0.0, 0.0)
zone = 43
northern = True
if loc is not None:
    if loc.get("netOffset"):
        ox, oy = loc.get("netOffset").split(",")
        net_offset = (float(ox), float(oy))
    proj = loc.get("projParameter") or ""
    m = re.search(r"\+zone=(\d+)", proj)
    if m:
        zone = int(m.group(1))
    if "+south" in proj:
        northern = False

# SUMO net coords are UTM coords plus netOffset. Reverse that to recover UTM.
def to_lonlat(x, y):
    ex = x - net_offset[0]
    ny = y - net_offset[1]
    lat, lon = utm_to_latlon(ex, ny, zone, northern)
    return lon, lat


junctions = {}
for j in root.findall("junction"):
    jid = j.get("id")
    if jid is None:
        continue
    try:
        x = float(j.get("x"))
        y = float(j.get("y"))
    except (TypeError, ValueError):
        continue
    junctions[jid] = (x, y)

edges = {}
for e in root.findall("edge"):
    eid = e.get("id")
    if eid is None:
        continue
    edges[normalize_edge_id(eid)] = e


def edge_to_lines(edge_el):
    shape = edge_el.get("shape")
    if not shape:
        lane = edge_el.find("lane")
        if lane is not None and lane.get("shape"):
            shape = lane.get("shape")
    if shape:
        pts = parse_shape(shape)
        return [[to_lonlat(x, y) for x, y in pts]]

    fr = edge_el.get("from")
    to = edge_el.get("to")
    if fr in junctions and to in junctions:
        return [[to_lonlat(*junctions[fr]), to_lonlat(*junctions[to])]]
    return []


# Load flow component edges
flow_component_edges = set()
with open(EDGE_FLOW_COMPONENT_FILE, newline="") as f:
    reader = csv.reader(f)
    next(reader, None)
    for row in reader:
        if not row:
            continue
        edge_id = normalize_edge_id(row[0])
        if edge_id:
            flow_component_edges.add(edge_id)

# Load cameras
with open(CAMERA_FILE, newline="") as f:
    reader = csv.DictReader(f)
    cam_rows = list(reader)

if cam_rows and "\ufeffcamera" in cam_rows[0] and "camera" not in cam_rows[0]:
    for r in cam_rows:
        r["camera"] = r.pop("\ufeffcamera")

# Build features
camera_features = []
edge_features = []
non_internal_edge_features = []
junction_features = []

for r in cam_rows:
    try:
        lat = float(r["latitude"])
        lon = float(r["longitude"])
    except (ValueError, KeyError):
        continue
    props = {
        "kind": "camera",
        "marker": "circle",
        "marker_radius": 6,
        "camera": r.get("camera"),
        "assigned_node_id": r.get("assigned_node_id"),
        "node_x": float(r["node_x"]) if r.get("node_x") else None,
        "node_y": float(r["node_y"]) if r.get("node_y") else None,
        "distance_m": float(r["distance_m"]) if r.get("distance_m") else None,
    }
    camera_features.append(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        }
    )

# Component edges (from flow component classes)
all_component_edges = set(flow_component_edges)
missing_component_edges = 0

for edge_id in sorted(all_component_edges):
    edge_el = edges.get(edge_id)
    if edge_el is None:
        missing_component_edges += 1
        continue
    lines = edge_to_lines(edge_el)
    if not lines:
        missing_component_edges += 1
        continue
    coords = lines[0]
    props = {
        "kind": "edge",
        "edge_id": edge_id,
        "from": edge_el.get("from"),
        "to": edge_el.get("to"),
        "type": edge_el.get("type"),
        "priority": edge_el.get("priority"),
        "numLanes": edge_el.get("numLanes"),
        "speed": edge_el.get("speed"),
        "length": edge_el.get("length"),
        "in_flow_component": edge_id in flow_component_edges,
    }
    edge_features.append(
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": props,
        }
    )

for edge_id in sorted(edges):
    edge_el = edges.get(edge_id)
    if edge_el is None or edge_el.get("function") == "internal":
        continue
    lines = edge_to_lines(edge_el)
    if not lines:
        continue
    coords = lines[0]
    props = {
        "kind": "edge",
        "edge_id": edge_id,
        "from": edge_el.get("from"),
        "to": edge_el.get("to"),
        "type": edge_el.get("type"),
        "priority": edge_el.get("priority"),
        "numLanes": edge_el.get("numLanes"),
        "speed": edge_el.get("speed"),
        "length": edge_el.get("length"),
        "function": edge_el.get("function"),
        "in_flow_component": edge_id in flow_component_edges,
    }
    non_internal_edge_features.append(
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": props,
        }
    )

for edge_id in sorted(edges):
    edge_el = edges.get(edge_id)
    if edge_el is None or edge_el.get("function") != "internal":
        continue
    lines = edge_to_lines(edge_el)
    if not lines or not lines[0]:
        continue
    coords = lines[0]
    mid_idx = len(coords) // 2
    mid = coords[mid_idx]
    props = {
        "kind": "junction",
        "edge_id": edge_id,
        "from": edge_el.get("from"),
        "to": edge_el.get("to"),
        "type": edge_el.get("type"),
        "priority": edge_el.get("priority"),
        "numLanes": edge_el.get("numLanes"),
        "speed": edge_el.get("speed"),
        "length": edge_el.get("length"),
        "function": edge_el.get("function"),
    }
    junction_features.append(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": mid},
            "properties": props,
        }
    )

OUT_CAMERAS_GEOJSON.write_text(
    json.dumps({"type": "FeatureCollection", "features": camera_features})
)
OUT_EDGES_GEOJSON.write_text(
    json.dumps({"type": "FeatureCollection", "features": edge_features})
)
OUT_NON_INTERNAL_EDGES_GEOJSON.write_text(
    json.dumps({"type": "FeatureCollection", "features": non_internal_edge_features})
)
OUT_JUNCTIONS_GEOJSON.write_text(
    json.dumps({"type": "FeatureCollection", "features": junction_features})
)

# Camera to edge mapping (unchanged behavior, uses flow component edges only)
# Build edge-by-node index
edges_by_node = defaultdict(set)
for e in root.findall("edge"):
    fr = e.get("from")
    to = e.get("to")
    eid = e.get("id")
    if fr is None or to is None or eid is None:
        continue
    eid_n = normalize_edge_id(eid)
    edges_by_node[fr].add(eid_n)
    edges_by_node[to].add(eid_n)

with open(OUT_CAMERA_EDGE_MAP, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(
        [
            "camera",
            "assigned_node_id",
            "flow_edge_ids",
            "flow_edge_count",
            "all_edge_ids",
            "all_edge_count",
        ]
    )
    for r in cam_rows:
        camera = r.get("camera")
        node = r.get("assigned_node_id")
        all_edges = sorted(edges_by_node.get(node, set()))
        flow = sorted([e for e in all_edges if e in flow_component_edges])
        writer.writerow(
            [
                camera,
                node,
                "|".join(flow),
                len(flow),
                "|".join(all_edges),
                len(all_edges),
            ]
        )

print(
    "wrote",
    OUT_CAMERAS_GEOJSON.name + ",",
    OUT_EDGES_GEOJSON.name + ",",
    OUT_NON_INTERNAL_EDGES_GEOJSON.name + ",",
    OUT_JUNCTIONS_GEOJSON.name + ",",
    OUT_CAMERA_EDGE_MAP.name,
)
print("cameras", len(cam_rows))
print("component edges", len(all_component_edges))
print("missing component edges", missing_component_edges)
