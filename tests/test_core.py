from baseguard.domain import Coordinate, ImageMeta, TrackPoint
from baseguard.geo import distance_m, pixel_to_coordinate
from baseguard.tracking import motion_features


def test_pixel_to_coordinate_uses_image_corners():
    meta = ImageMeta(
        image_id="img",
        width_px=100,
        height_px=100,
        capture_time="10:00",
        top_left=Coordinate(lat=40, lon=32),
        top_right=Coordinate(lat=40, lon=33),
        bottom_left=Coordinate(lat=39, lon=32),
        bottom_right=Coordinate(lat=39, lon=33),
    )
    assert pixel_to_coordinate(meta, 50, 50) == Coordinate(lat=39.5, lon=32.5)


def test_motion_features_identifies_approach_and_tti():
    base = Coordinate(lat=39.92184, lon=32.85306)
    points = [
        TrackPoint(
            track_id="T1",
            time="10:00",
            coordinate=Coordinate(lat=39.94000, lon=32.85306),
        ),
        TrackPoint(
            track_id="T1",
            time="10:05",
            coordinate=Coordinate(lat=39.92500, lon=32.85306),
        ),
        TrackPoint(
            track_id="T1",
            time="10:10",
            coordinate=Coordinate(lat=39.92200, lon=32.85306),
        ),
    ]
    features = motion_features(points, base)
    assert features.state == "yaklasiyor"
    assert features.tti_seconds is not None
    assert distance_m(points[-1].coordinate, base) < distance_m(
        points[0].coordinate, base
    )
