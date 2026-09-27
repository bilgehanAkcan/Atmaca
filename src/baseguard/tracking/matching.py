"""Detection-to-track assignment at a single capture timestamp."""

from __future__ import annotations

from baseguard.domain import Detection, TrackPoint
from baseguard.geo import distance_m


def assign_tracks(
    detections: list[Detection],
    tracks: dict[str, list[TrackPoint]],
    gate_m: float,
) -> tuple[dict[str, tuple[str, float]], list[str], list[str]]:
    """Globally optimal one-to-one assignment of detections to track end points.

    Returns ``{det_id: (track_id, distance_m)}``, unmatched detection IDs, and
    unmatched track IDs. Pairs farther apart than ``gate_m`` are left unmatched.
    """
    from scipy.optimize import linear_sum_assignment

    valid = [item for item in detections if item.coordinate is not None]
    track_ids = list(tracks)
    if not valid or not track_ids:
        return {}, [item.det_id for item in valid], track_ids
    costs = [
        [
            distance_m(detection.coordinate, tracks[track_id][-1].coordinate)
            for track_id in track_ids
        ]
        for detection in valid
    ]
    rows, columns = linear_sum_assignment(costs)
    matched: dict[str, tuple[str, float]] = {}
    for row, column in zip(rows, columns):
        if costs[row][column] <= gate_m:
            matched[valid[row].det_id] = (track_ids[column], round(costs[row][column], 2))
    used_tracks = {track_id for track_id, _ in matched.values()}
    return (
        matched,
        [item.det_id for item in valid if item.det_id not in matched],
        [item for item in track_ids if item not in used_tracks],
    )

