"""Geographic primitives; all public distances are metres."""

from __future__ import annotations

from math import asin, atan2, cos, degrees, radians, sin, sqrt

from baseguard.domain import Coordinate, ImageMeta, Zone

EARTH_RADIUS_M = 6_371_008.8


def distance_m(first: Coordinate, second: Coordinate) -> float:
    d_lat, d_lon = radians(second.lat - first.lat), radians(second.lon - first.lon)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(first.lat)) * cos(radians(second.lat)) * sin(d_lon / 2) ** 2
    )
    return EARTH_RADIUS_M * 2 * asin(sqrt(a))


def bearing_deg(first: Coordinate, second: Coordinate) -> float:
    delta_lon = radians(second.lon - first.lon)
    first_lat, second_lat = radians(first.lat), radians(second.lat)
    y = sin(delta_lon) * cos(second_lat)
    x = cos(first_lat) * sin(second_lat) - sin(first_lat) * cos(second_lat) * cos(
        delta_lon
    )
    return (degrees(atan2(y, x)) + 360) % 360


def pixel_to_coordinate(meta: ImageMeta, x_px: float, y_px: float) -> Coordinate:
    """Bilinear interpolation over the metadata footprint."""
    if not 0 <= x_px <= meta.width_px or not 0 <= y_px <= meta.height_px:
        raise ValueError("Detection center falls outside the image bounds")
    u, v = x_px / meta.width_px, y_px / meta.height_px
    top_lat, top_lon = meta.top_left.lat + u * (
        meta.top_right.lat - meta.top_left.lat
    ), meta.top_left.lon + u * (meta.top_right.lon - meta.top_left.lon)
    bottom_lat, bottom_lon = meta.bottom_left.lat + u * (
        meta.bottom_right.lat - meta.bottom_left.lat
    ), meta.bottom_left.lon + u * (meta.bottom_right.lon - meta.bottom_left.lon)
    return Coordinate(
        lat=top_lat + v * (bottom_lat - top_lat),
        lon=top_lon + v * (bottom_lon - top_lon),
    )


def footprint_center(meta: ImageMeta) -> Coordinate:
    return pixel_to_coordinate(meta, meta.width_px / 2, meta.height_px / 2)


def nearest_zone(point: Coordinate, zones: list[Zone]) -> str | None:
    return (
        min(zones, key=lambda zone: distance_m(point, zone.center)).name
        if zones
        else None
    )


def coordinate_to_pixel(meta: ImageMeta, point: Coordinate) -> tuple[float, float]:
    """Inverse of the task's linear corner formula (north-up, axis-aligned image)."""
    x = (point.lon - meta.top_left.lon) / (meta.top_right.lon - meta.top_left.lon)
    y = (point.lat - meta.top_left.lat) / (meta.bottom_left.lat - meta.top_left.lat)
    return x * meta.width_px, y * meta.height_px


def footprint_contains(meta: ImageMeta, point: Coordinate) -> bool:
    x_px, y_px = coordinate_to_pixel(meta, point)
    return 0 <= x_px <= meta.width_px and 0 <= y_px <= meta.height_px


def footprint_size_m(meta: ImageMeta) -> tuple[float, float]:
    """Ground width and height of the image footprint."""
    return distance_m(meta.top_left, meta.top_right), distance_m(
        meta.top_left, meta.bottom_left
    )


def zone_of(point: Coordinate, zones: list[Zone], radius_m: float) -> str | None:
    """Nearest zone name, or None when the point is outside every zone radius."""
    if not zones:
        return None
    zone = min(zones, key=lambda item: distance_m(point, item.center))
    return zone.name if distance_m(point, zone.center) <= radius_m else None
