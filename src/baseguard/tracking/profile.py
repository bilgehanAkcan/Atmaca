"""Whole-track behaviour profile: stops, zones passed, distance trend, label."""

from __future__ import annotations

from itertools import pairwise

from baseguard.domain import Coordinate, TrackPoint, Zone
from baseguard.geo import distance_m, zone_of

from .kinematics import minutes, motion_features
from .patterns import ZONE_RADIUS_M, circling_deg, zone_entries

STOP_SPEED_MS = 0.3
TREND_STEP_MIN = 30
LOITER_TORTUOSITY = 3.0
LONG_STOP_MIN = 30


def _segment_speeds(points: list[TrackPoint]) -> list[float]:
    speeds = []
    for earlier, later in pairwise(points):
        seconds = (minutes(later.time) - minutes(earlier.time)) * 60
        speeds.append(
            distance_m(earlier.coordinate, later.coordinate) / seconds if seconds else 0.0
        )
    return speeds


def _stops(
    points: list[TrackPoint], speeds: list[float], zones: list[Zone]
) -> list[dict]:
    stops, start = [], None
    for index, speed in enumerate(speeds + [float("inf")]):
        if speed < STOP_SPEED_MS and start is None:
            start = index
        elif speed >= STOP_SPEED_MS and start is not None:
            first, last = points[start], points[index]
            stops.append(
                {
                    "start": first.time,
                    "end": last.time,
                    "minutes": minutes(last.time) - minutes(first.time),
                    "lat": round(first.coordinate.lat, 6),
                    "lon": round(first.coordinate.lon, 6),
                    "zone": zone_of(first.coordinate, zones, ZONE_RADIUS_M),
                }
            )
            start = None
    return stops


def _route_zones(points: list[TrackPoint], zones: list[Zone]) -> list[str]:
    route: list[str] = []
    for point in points:
        zone = zone_of(point.coordinate, zones, ZONE_RADIUS_M)
        if zone and (not route or route[-1] != zone):
            route.append(zone)
    return route


def _behavior(
    state: str,
    stopped_share: float,
    tortuosity: float,
    has_stops: bool,
    current_stop_min: int,
) -> str:
    if stopped_share >= 0.9:
        return "park_halinde"
    if tortuosity >= LOITER_TORTUOSITY and state not in {"yaklasiyor", "uzaklasiyor"}:
        return "dolasiyor"
    if state == "yaklasiyor":
        return "durup_yaklasiyor" if has_stops else "yaklasiyor"
    if state == "uzaklasiyor":
        return "uzaklasiyor"
    if state == "duruyor":
        return "uzun_sure_duruyor" if current_stop_min >= LONG_STOP_MIN else "yeni_durdu"
    return "durup_kalkiyor" if has_stops else "transit"


def track_profile(
    track_id: str, points: list[TrackPoint], base: Coordinate, zones: list[Zone]
) -> dict:
    """Deterministic summary of a full track; every number here is computed."""
    motion = motion_features(points, base)
    speeds = _segment_speeds(points)
    path_m = sum(
        distance_m(earlier.coordinate, later.coordinate)
        for earlier, later in pairwise(points)
    )
    net_m = distance_m(points[0].coordinate, points[-1].coordinate) if points else 0.0
    stops = _stops(points, speeds, zones)
    window_min = minutes(points[-1].time) - minutes(points[0].time) if points else 0
    stopped_share = (
        sum(item["minutes"] for item in stops) / window_min if window_min else 0.0
    )
    tortuosity = path_m / net_m if net_m > 1 else float("inf") if path_m > 1 else 1.0
    end = minutes(points[-1].time) if points else 0
    trend = [
        {"time": point.time, "dist_base_m": round(distance_m(point.coordinate, base))}
        for point in points
        if (end - minutes(point.time)) % TREND_STEP_MIN == 0
    ]
    return {
        "track_id": track_id,
        "start": points[0].time if points else None,
        "end": points[-1].time if points else None,
        "points": len(points),
        "last_position": (
            {"lat": points[-1].coordinate.lat, "lon": points[-1].coordinate.lon}
            if points
            else None
        ),
        "speed_now_ms": round(speeds[-1], 2) if speeds else None,
        "speed_median_ms": motion.speed_med_ms,
        "approach_rate_ms": motion.approach_rate_ms,
        "heading_deg": motion.heading_deg,
        "dist_trend": trend,
        "path_length_m": round(path_m),
        "net_displacement_m": round(net_m),
        "stops": stops,
        "route_zones": _route_zones(points, zones),
        # Inputs of the K8 (circling) and K9 (zone re-entry) risk rules.
        "circling_deg": round(circling_deg(points, base)),
        "zone_entries": zone_entries(points, zones),
        "state": motion.state,
        "current_stop_min": motion.stopped_min,
        "behavior": _behavior(
            motion.state, stopped_share, tortuosity, bool(stops), motion.stopped_min
        ),
        "eta_to_base_s": motion.tti_seconds,
    }
