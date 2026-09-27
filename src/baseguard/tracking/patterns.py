"""Movement patterns over a track (or its prefix): circling the base, zone re-entries."""

from __future__ import annotations

from itertools import pairwise

from baseguard.domain import Coordinate, TrackPoint, Zone
from baseguard.geo import bearing_deg, distance_m

# Zone centres sit ~3.2 km from the base and ~2.4 km from each other.
ZONE_RADIUS_M = 1_500

# Only turns made this close to the base count as circling it.
CIRCLING_RADIUS_M = 5_000
# A vehicle has left a zone only once it is this far outside its radius, so driving
# along the zone edge does not count as repeated entries.
REENTRY_EXIT_MARGIN_M = 500


def circling_deg(points: list[TrackPoint], base: Coordinate) -> float:
    """Signed angle swept around the base, summed over steps near the base.

    +/-360 is one full turn; back-and-forth movement cancels out.
    """
    total = 0.0
    for earlier, later in pairwise(points):
        if max(
            distance_m(earlier.coordinate, base), distance_m(later.coordinate, base)
        ) > CIRCLING_RADIUS_M:
            continue
        step = bearing_deg(base, later.coordinate) - bearing_deg(base, earlier.coordinate)
        total += (step + 180) % 360 - 180
    return total


def zone_entries(points: list[TrackPoint], zones: list[Zone]) -> dict[str, int]:
    """How many times the track entered each zone it visited."""
    entries: dict[str, int] = {}
    for zone in zones:
        inside, count = False, 0
        for point in points:
            distance = distance_m(point.coordinate, zone.center)
            if not inside and distance <= ZONE_RADIUS_M:
                inside, count = True, count + 1
            elif inside and distance > ZONE_RADIUS_M + REENTRY_EXIT_MARGIN_M:
                inside = False
        if count:
            entries[zone.name] = count
    return entries
