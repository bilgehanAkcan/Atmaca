"""Time-filtered 3D scene: every vehicle known up to the sim time.

Only track rows, image observations and reports with a time at or before `until`
are used, so the UI never sees the future. Two kinds of vehicle entity:

- `track`: a tracks.csv trace from its first row up to `until`, plus the images in
  which it was detected (detection pixel centre -> lat/lon via the corner formula).
- `static`: a detection with no movement record (e.g. parked), from its capture time.

An entity stays visible for LINGER_MIN after its last known position. A track is
scored with the K1-K3 motion rules, the K8-K9 route-pattern rules plus K5-K7 for every field report linked to it
(reports/verification.py). Display category: 1 = tracked with score 0 (normal /
logistics flow, green); 2 = untracked or score > 0 (red). Class is known only
after a detection.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import TYPE_CHECKING

from baseguard.agent import handlers
from baseguard.agent.toolkit import GetImageContextInput, MatchTracksInput
from baseguard.domain import Coordinate, FiredRule
from baseguard.geo import distance_m
from baseguard.reports import ReportLink, link_reports, report_verdict
from baseguard.risk import (
    image_level,
    score_pattern,
    score_report_verdict,
    score_vehicle,
    total_points,
)
from baseguard.tracking import circling_deg, motion_features, zone_entries

from .clock import to_minutes

if TYPE_CHECKING:
    from baseguard.agent.toolkit import ToolContext

CATEGORY_LABELS = {1: "Takipli akis / lojistik", 2: "Kural ihlali / takipsiz"}
LINGER_MIN = 30
REPORT_RULES = frozenset({"K5", "K6", "K7"})


def vehicle_category(
    track_id: str | None, score: int, rule_reasons: list[str]
) -> tuple[int, list[str]]:
    reasons = [] if track_id else ["hareket kaydi yok (takipsiz)"]
    reasons += rule_reasons
    red = not track_id or score > 0
    return (2 if red else 1), (reasons or ["takipli, kural tetiklenmedi"])


def _rule_reason(rule: FiredRule) -> str:
    """Report rules name their report (refs[0]) so the operator can look it up."""
    reason = f"{rule.rule_id} {rule.name} ({rule.points:+d})"
    return f"{reason} · {rule.refs[0]}" if rule.rule_id in REPORT_RULES else reason


class SceneBuilder:
    """Per-image detections are static, so they are computed once and cached."""

    def __init__(self, context: ToolContext) -> None:
        self._context = context
        self._lock = threading.Lock()
        self._images: dict[str, dict] = {}
        self._index: tuple[dict[str, list[dict]], list[dict]] | None = None
        self._links: dict[str, list[ReportLink]] | None = None

    def _report_links(self) -> dict[str, list[ReportLink]]:
        """Links use only track rows up to each report's time, so they are static."""
        with self._lock:
            if self._links is None:
                data = self._context.data
                self._links = link_reports(data.reports, data.tracks, data.base, data.zones)
            return self._links

    def image(self, image_id: str) -> dict:
        with self._lock:
            if image_id not in self._images:
                self._images[image_id] = self._build_image(image_id)
            return self._images[image_id]

    def _build_image(self, image_id: str) -> dict:
        context = self._context
        info = handlers.get_image_context(context, GetImageContextInput(image_id=image_id))
        matched = handlers.match_tracks(context, MatchTracksInput(image_id=image_id))
        tracks = {item["det_id"]: item for item in matched["matches"]}
        corners = {name: [c["lat"], c["lon"]] for name, c in info["corners"].items()}
        observations = []
        for detection in context.detections[image_id]:
            match = tracks.get(detection.det_id)
            observations.append(
                {
                    "image_id": image_id,
                    "capture_time": info["capture_time"],
                    "zone": info["nearest_zone"],
                    "det_id": detection.det_id,
                    "cls": detection.vehicle_class,
                    "conf": (
                        round(detection.confidence, 3)
                        if detection.confidence is not None
                        else None
                    ),
                    "bbox_xywh": [round(value, 1) for value in detection.bbox_xywh],
                    "center_px": [round(value, 1) for value in detection.center_px],
                    "lat": round(detection.coordinate.lat, 6),
                    "lon": round(detection.coordinate.lon, 6),
                    "track_id": match["track_id"] if match else None,
                    "match_dist_m": match["match_dist_m"] if match else None,
                    "corners": corners,
                }
            )
        return {
            "image_id": image_id,
            "capture_time": info["capture_time"],
            "source": context.detection_source[image_id],
            "observations": observations,
        }

    def _observations(self) -> tuple[dict[str, list[dict]], list[dict]]:
        """track_id -> its detections (by capture time), and untracked detections."""
        if self._index is None:
            by_track: dict[str, list[dict]] = defaultdict(list)
            untracked: list[dict] = []
            for image_id in self._context.data.meta:
                for item in self.image(image_id)["observations"]:
                    (by_track[item["track_id"]] if item["track_id"] else untracked).append(item)
            for items in by_track.values():
                items.sort(key=lambda item: item["capture_time"])
            self._index = dict(by_track), untracked
        return self._index

    def _track_entity(self, track_id: str, now: int, seen: list[dict]) -> dict | None:
        data = self._context.data
        points = [p for p in data.tracks[track_id] if to_minutes(p.time) <= now]
        if not points or now - to_minutes(points[-1].time) > LINGER_MIN:
            return None
        cls = seen[-1]["cls"] if seen else "unknown"
        motion = motion_features(points, data.base)
        rules = score_vehicle(track_id, cls, track_id, motion)
        rules += score_pattern(
            track_id, track_id, circling_deg(points, data.base), zone_entries(points, data.zones)
        )
        reports = []
        for link in self._report_links().get(track_id, []):
            report = link.report
            if to_minutes(report.time) > now:
                continue
            verdict = report_verdict(link, cls)
            rules += score_report_verdict(
                report.report_id, report.claims_friendly, verdict, [track_id]
            )
            reports.append(
                {
                    "report_id": report.report_id,
                    "time": report.time,
                    "source": report.source,
                    "text": report.text,
                    "verdict": verdict,
                    "distance_m": link.distance_m,
                }
            )
        score = total_points(rules)
        category, reasons = vehicle_category(
            track_id, score, [_rule_reason(rule) for rule in rules]
        )
        last = points[-1].coordinate
        return {
            "id": track_id,
            "kind": "track",
            "cls": cls,
            "category": category,
            "category_label": CATEGORY_LABELS[category],
            "score": score,
            "risk_level": image_level(score),
            "reasons": reasons,
            "rule_ids": [rule.rule_id for rule in rules],
            "reports": reports,
            "state": motion.state,
            "speed_ms": motion.speed_med_ms,
            "heading_deg": motion.heading_deg,
            "approach_rate_ms": motion.approach_rate_ms,
            "dist_to_base_m": round(distance_m(last, data.base)),
            "last_time": points[-1].time,
            "stale_min": now - to_minutes(points[-1].time),
            "points": [
                [p.time, round(p.coordinate.lat, 6), round(p.coordinate.lon, 6)] for p in points
            ],
            "observations": seen,
        }

    def _static_entity(self, item: dict, now: int) -> dict:
        category, reasons = vehicle_category(None, 0, [])
        return {
            "id": f"{item['image_id']}/{item['det_id']}",
            "kind": "static",
            "cls": item["cls"],
            "category": category,
            "category_label": CATEGORY_LABELS[category],
            "score": 0,
            "risk_level": image_level(0),
            "reasons": reasons,
            "rule_ids": [],
            "reports": [],
            "state": None,
            "speed_ms": None,
            "heading_deg": None,
            "approach_rate_ms": None,
            "dist_to_base_m": round(
                distance_m(self._context.data.base, Coordinate(lat=item["lat"], lon=item["lon"]))
            ),
            "last_time": item["capture_time"],
            "stale_min": now - to_minutes(item["capture_time"]),
            "points": [[item["capture_time"], item["lat"], item["lon"]]],
            "observations": [item],
        }

    def scene(self, until: str) -> dict:
        now = to_minutes(until)
        data = self._context.data
        by_track, untracked = self._observations()

        def visible(item: dict) -> bool:
            return to_minutes(item["capture_time"]) <= now

        vehicles = [
            entity
            for track_id in sorted(data.tracks)
            if (entity := self._track_entity(
                track_id, now, [item for item in by_track.get(track_id, []) if visible(item)]
            ))
        ]
        vehicles += [
            self._static_entity(item, now)
            for item in untracked
            if visible(item) and now - to_minutes(item["capture_time"]) <= LINGER_MIN
        ]
        return {
            "until": until,
            "linger_min": LINGER_MIN,
            "images_visible": sum(
                to_minutes(meta.capture_time) <= now for meta in data.meta.values()
            ),
            "images_total": len(data.meta),
            "reports_visible": sum(to_minutes(r.time) <= now for r in data.reports),
            "reports_total": len(data.reports),
            "vehicles": vehicles,
        }

