from baseguard.domain import Coordinate, TrackPoint
from baseguard.tracking import motion_features


def test_two_track_points_produce_approach_rate_and_arrival_time():
    base = Coordinate(lat=39.0, lon=32.0)
    points = [
        TrackPoint(
            track_id="T1", time="10:00", coordinate=Coordinate(lat=39.010, lon=32.0)
        ),
        TrackPoint(
            track_id="T1", time="10:02", coordinate=Coordinate(lat=39.001, lon=32.0)
        ),
    ]

    features = motion_features(points, base)

    assert features.state == "yaklasiyor"
    assert features.approach_rate_ms is not None
    assert features.approach_rate_ms > 8
    assert features.tti_seconds is not None
    assert features.tti_seconds < 20


def test_three_track_points_use_regression_for_approach_rate():
    base = Coordinate(lat=39.0, lon=32.0)
    points = [
        TrackPoint(
            track_id="T1", time="10:00", coordinate=Coordinate(lat=39.010, lon=32.0)
        ),
        TrackPoint(
            track_id="T1", time="10:02", coordinate=Coordinate(lat=39.006, lon=32.0)
        ),
        TrackPoint(
            track_id="T1", time="10:04", coordinate=Coordinate(lat=39.002, lon=32.0)
        ),
    ]

    features = motion_features(points, base)

    # 444.8 m every 120 s along a straight line towards the base.
    assert abs(features.approach_rate_ms - 3.71) < 0.05
    assert features.dist_base_m["t0"] < features.dist_base_m["t-120"]