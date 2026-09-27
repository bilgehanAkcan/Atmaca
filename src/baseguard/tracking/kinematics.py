"""Track feature extraction. The LLM never calculates these values."""

from __future__ import annotations

from itertools import pairwise
from statistics import median

from baseguard.domain import Coordinate, MotionFeatures, TrackPoint
from baseguard.geo import bearing_deg, distance_m


def minutes(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def candidate_tracks_at_capture(
    tracks: dict[str, list[TrackPoint]], capture_time: str
) -> dict[str, list[TrackPoint]]:
    return {
        track_id: points
        for track_id, points in tracks.items()
        if points and points[-1].time == capture_time
    }


def _linear_slope(x_values: list[float], y_values: list[float]) -> float | None:
    """Return least-squares slope without adding a second numerical dependency."""
    if len(x_values) < 2:
        return None
    x_mean = sum(x_values) / len(x_values)
    y_mean = sum(y_values) / len(y_values)
    denominator = sum((value - x_mean) ** 2 for value in x_values)
    if denominator == 0:
        return None
    return sum(
        (x_value - x_mean) * (y_value - y_mean)
        for x_value, y_value in zip(x_values, y_values, strict=True)
    ) / denominator


def motion_features(points: list[TrackPoint], base: Coordinate) -> MotionFeatures:
    if len(points) < 2:
        return MotionFeatures(state="bilinmiyor")
    distances = [distance_m(point.coordinate, base) for point in points]
    speeds: list[float] = []
    for earlier, later in pairwise(points):
        elapsed_seconds = (minutes(later.time) - minutes(earlier.time)) * 60
        if elapsed_seconds > 0:
            speeds.append(
                distance_m(earlier.coordinate, later.coordinate) / elapsed_seconds
            )
    last_speeds = speeds[-6:]
    elapsed_seconds = (minutes(points[-1].time) - minutes(points[0].time)) * 60
    elapsed_from_start = [
        (minutes(point.time) - minutes(points[0].time)) * 60 for point in points
    ]
    distance_slope = (
        _linear_slope(elapsed_from_start, distances)
        if len(points) >= 3
        else (distances[-1] - distances[0]) / elapsed_seconds
        if elapsed_seconds
        else None
    )
    approach_rate = -distance_slope if distance_slope is not None else None
    recent_speed = median(last_speeds) if last_speeds else None
    state = (
        "duruyor" if recent_speed is not None and recent_speed < 0.3 else "bilinmiyor"
    )
    if state != "duruyor" and approach_rate is not None:
        state = (
            "yaklasiyor"
            if approach_rate > 0.5
            else "uzaklasiyor" if approach_rate < -0.5 else "yatay"
        )
    stopped = 0
    for speed in reversed(speeds):
        if speed >= 0.3:
            break
        stopped += 5
    eta_seconds = (
        distances[-1] / approach_rate
        if approach_rate is not None and approach_rate > 0.5
        else None
    )
    return MotionFeatures(
        speed_med_ms=round(median(speeds), 2) if speeds else None,
        heading_deg=round(bearing_deg(points[-2].coordinate, points[-1].coordinate), 1),
        dist_base_m={"t-120": round(distances[0], 1), "t0": round(distances[-1], 1)},
        approach_rate_ms=round(approach_rate, 2) if approach_rate is not None else None,
        tti_seconds=round(eta_seconds, 1) if eta_seconds else None,
        stopped_min=stopped,
        state=state,
    )
