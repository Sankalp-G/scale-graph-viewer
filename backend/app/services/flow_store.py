from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union


def normalize_edge_id(edge_id: Any) -> str:
    if edge_id is None:
        return ""
    text = str(edge_id).strip().lstrip("\ufeff")
    if not text:
        return ""
    match = re.match(r"^(\d+)\.0(#.*)?$", text)
    if match:
        return match.group(1) + (match.group(2) or "")
    return text


def parse_value(raw: str) -> Union[float, int]:
    value_text = raw.strip()
    if not value_text:
        return 0
    try:
        value = float(value_text)
    except ValueError:
        return 0
    if value.is_integer():
        return int(value)
    return value


def load_flow_csv(path: Path) -> Tuple[List[str], List[Tuple[str, List[Union[float, int]]]]]:
    with path.open(newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, [])
        timestamps = [entry.strip() for entry in header[1:]]
        rows: List[Tuple[str, List[Union[float, int]]]] = []
        for row in reader:
            if len(row) < 2:
                continue
            edge_id = normalize_edge_id(row[0])
            if not edge_id:
                continue
            values = [parse_value(value) for value in row[1 : len(timestamps) + 1]]
            rows.append((edge_id, values))
    return timestamps, rows


def load_geometry_map(path: Path) -> Dict[str, Dict[str, Any]]:
    data = json.loads(path.read_text())
    geometry_map: Dict[str, Dict[str, Any]] = {}
    for feature in data.get("features", []):
        properties = feature.get("properties") or {}
        edge_id = normalize_edge_id(properties.get("edge_id"))
        geometry = feature.get("geometry")
        if not edge_id or not geometry:
            continue
        geometry_map[edge_id] = geometry
    return geometry_map


class FlowStore:
    def __init__(
        self,
        timestamps: List[str],
        rows: List[Tuple[str, List[Union[float, int]]]],
        geometry_map: Dict[str, Dict[str, Any]],
    ) -> None:
        self.timestamps = timestamps
        self.rows = rows
        self.geometry_map = geometry_map

    @property
    def total_frames(self) -> int:
        return len(self.timestamps)

    def build_frame(self, index: int) -> Dict[str, Any]:
        features: List[Dict[str, Any]] = []
        for edge_id, values in self.rows:
            geometry = self.geometry_map.get(edge_id)
            if not geometry:
                continue
            value = values[index] if index < len(values) else 0
            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {"edge_id": edge_id, "value": value},
                }
            )
        return {"type": "FeatureCollection", "features": features}

    def build_edge_results(self, index: int) -> List[Dict[str, int]]:
        results: List[Dict[str, int]] = []
        for edge_id, values in self.rows:
            value = values[index] if index < len(values) else 0
            classification = int(value) if value is not None else 0
            results.append(
                {
                    "edge_id": edge_id,
                    "count": 0,
                    "classification": classification,
                }
            )
        return results


def load_flow_store(data_dir: Path) -> FlowStore:
    timestamps, rows = load_flow_csv(data_dir / "edge_flow_component_classes.csv")
    geometry_map = load_geometry_map(data_dir / "edges_non_internal.geojson")
    return FlowStore(timestamps, rows, geometry_map)
