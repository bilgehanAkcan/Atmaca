"""Deterministic report-to-track checks for the live scene; no LLM is involved.

A located report is linked to the tracks nearest its coordinate at report time
(as many as it claims, default one). A zone report denying heavy traffic
("agir arac hareketi yok") is linked to every track in that zone. The verdict
compares only what tracks and detections can show - vehicle class and motion
state - so colour and count claims stay with the agent (inspect_crop).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from baseguard.domain import Coordinate, FieldReport, TrackPoint, Zone
from baseguard.geo import distance_m
from baseguard.tracking.kinematics import minutes, motion_features
from baseguard.tracking.profile import ZONE_RADIUS_M

LINK_RADIUS_M = 100
# The track must have a position at most this long before the report time.
LINK_WINDOW_MIN = 10
HEAVY = frozenset({"truck", "bus"})
MOVING = frozenset({"yaklasiyor", "uzaklasiyor", "yatay"})
EXPECTED_STATES = {
    "stationary": frozenset({"duruyor"}),
    "approaching": frozenset({"yaklasiyor"}),
    "departing": frozenset({"uzaklasiyor"}),
    "moving": MOVING,
}
CHECKABLE_CLASSES = frozenset({"car", "van", "truck", "bus", "heavy"})


@dataclass(frozen=True)
class ReportLink:
    report: FieldReport
    state: str  # track motion state at report time
    distance_m: float


def _denies_heavy_traffic(report: FieldReport) -> bool:
    return report.claim_type == "no_activity" and report.claimed_vehicle == "heavy"


def _prefix_at(points: list[TrackPoint], time_min: int) -> list[TrackPoint] | None:
    """Track rows up to ``time_min``, or None if the track was not there then."""
    prefix = [point for point in points if minutes(point.time) <= time_min]
    if not prefix or time_min - minutes(prefix[-1].time) > LINK_WINDOW_MIN:
        return None
    return prefix


def link_reports(
    reports: list[FieldReport],
    tracks: dict[str, list[TrackPoint]],
    base: Coordinate,
    zones: list[Zone],
) -> dict[str, list[ReportLink]]:
    """track_id -> reports about it. Uses only track rows up to each report's time."""
    zone_centers = {zone.name: zone.center for zone in zones}
    links: dict[str, list[ReportLink]] = defaultdict(list)
    for report in reports:
        if report.coordinate is not None:
            target, radius, limit = report.coordinate, LINK_RADIUS_M, report.claimed_count or 1
        elif _denies_heavy_traffic(report) and report.zone_name in zone_centers:
            target, radius, limit = zone_centers[report.zone_name], ZONE_RADIUS_M, None
        else:
            continue
        time_min = minutes(report.time)
        near = sorted(
            (distance, track_id, prefix)
            for track_id, points in tracks.items()
            if (prefix := _prefix_at(points, time_min))
            and (distance := distance_m(prefix[-1].coordinate, target)) <= radius
        )
        for distance, track_id, prefix in near[:limit]:
            state = motion_features(prefix, base).state
            links[track_id].append(ReportLink(report, state, round(distance, 1)))
    return dict(links)


def report_verdict(link: ReportLink, vehicle_class: str) -> str:
    """uyumlu / celiskili from class and motion; the rest cannot be checked here."""
    report = link.report
    if report.coordinate is None:  # zone report denying heavy traffic
        moving_heavy = vehicle_class in HEAVY and link.state in MOVING
        return "celiskili" if moving_heavy else "ilgisiz"
    checks: list[bool] = []
    claimed = report.claimed_vehicle
    if claimed in CHECKABLE_CLASSES and vehicle_class != "unknown":
        checks.append(vehicle_class in HEAVY if claimed == "heavy" else vehicle_class == claimed)
    if report.claimed_motion is not None and link.state != "bilinmiyor":
        checks.append(link.state in EXPECTED_STATES[report.claimed_motion])
    if not checks:
        return "dogrulanamaz"
    return "uyumlu" if all(checks) else "celiskili"