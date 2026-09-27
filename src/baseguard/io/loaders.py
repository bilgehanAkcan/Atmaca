"""Validated readers for the input data package and cached artifacts."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

from baseguard.domain import Coordinate, FieldReport, ImageMeta, TrackPoint, Zone


def _read_json(path: Path):
    if not path.is_file():
        raise FileNotFoundError(f"Missing required data file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_image_meta(data_dir: Path) -> dict[str, ImageMeta]:
    raw = _read_json(data_dir / "image_meta.json")
    records: dict[str, ImageMeta] = {}
    for image_id, value in raw.items():
        corners = value["corner_coordinates"]
        records[image_id] = ImageMeta(
            image_id=image_id,
            width_px=value["width_px"],
            height_px=value["height_px"],
            capture_time=value["capture_time"],
            top_left=Coordinate(lat=corners["top_left"][0], lon=corners["top_left"][1]),
            top_right=Coordinate(
                lat=corners["top_right"][0], lon=corners["top_right"][1]
            ),
            bottom_left=Coordinate(
                lat=corners["bottom_left"][0], lon=corners["bottom_left"][1]
            ),
            bottom_right=Coordinate(
                lat=corners["bottom_right"][0], lon=corners["bottom_right"][1]
            ),
        )
    return records


def load_zones(data_dir: Path) -> tuple[Coordinate, list[Zone]]:
    raw = _read_json(data_dir / "zones.json")
    base = Coordinate(lat=raw["base"]["lat"], lon=raw["base"]["lon"])
    zones = [
        Zone(
            name=item["name"],
            center=Coordinate(lat=item["center"][0], lon=item["center"][1]),
        )
        for item in raw["zones"]
    ]
    return base, zones


def load_tracks(data_dir: Path) -> dict[str, list[TrackPoint]]:
    path = data_dir / "tracks.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Missing required data file: {path}")
    tracks: dict[str, list[TrackPoint]] = defaultdict(list)
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            tracks[row["track_id"]].append(
                TrackPoint(
                    track_id=row["track_id"],
                    time=row["time"],
                    coordinate=Coordinate(lat=float(row["lat"]), lon=float(row["lon"])),
                )
            )
    for points in tracks.values():
        points.sort(key=lambda point: point.time)
    return dict(tracks)


def load_reports(data_dir: Path) -> list[FieldReport]:
    raw = _read_json(data_dir / "field_reports.json")
    return [
        FieldReport(report_id=f"R{index:03d}", **item)
        for index, item in enumerate(raw, start=1)
    ]


def write_artifact(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary.replace(path)
