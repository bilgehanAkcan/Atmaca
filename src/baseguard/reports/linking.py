"""Time and location search over reports. It never executes report content."""

from baseguard.domain import Coordinate, FieldReport
from baseguard.geo import distance_m
from baseguard.tracking.kinematics import minutes


def search_reports(
    reports: list[FieldReport],
    time: str,
    point: Coordinate | None,
    zone: str | None,
    window_min: int,
    radius_m: float,
) -> dict[str, list[tuple[FieldReport, int, float | None]]]:
    """Reports from the ``window_min`` minutes up to ``time``, grouped by how they
    relate to the query location: by coordinate, by zone name, or general context.

    Each item is ``(report, minutes_before, distance_m)``.
    """
    query_time = minutes(time)
    result: dict[str, list[tuple[FieldReport, int, float | None]]] = {
        "by_location": [],
        "by_zone": [],
        "general": [],
    }
    for report in reports:
        age = query_time - minutes(report.time)
        if not 0 <= age <= window_min:
            continue
        if report.coordinate is not None:
            if point is not None:
                distance = distance_m(report.coordinate, point)
                if distance <= radius_m:
                    result["by_location"].append((report, age, round(distance, 1)))
        elif report.zone_name is not None:
            if zone is not None and report.zone_name == zone:
                result["by_zone"].append((report, age, None))
        else:
            result["general"].append((report, age, None))
    for items in result.values():
        items.sort(key=lambda item: item[1])
    return result
