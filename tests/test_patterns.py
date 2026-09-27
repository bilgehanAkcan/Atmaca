"""Route-pattern features (circling, zone re-entry) and the K8/K9 rules."""

from __future__ import annotations

import math

from baseguard.domain import Coordinate, TrackPoint, Zone
from baseguard.risk import score_pattern
from baseguard.tracking import circling_deg, zone_entries
from baseguard.tracking.patterns import CIRCLING_RADIUS_M

BASE = Coordinate(lat=39.92184, lon=32.85306)
M_PER_DEG_LAT = 111_195.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(BASE.lat))


def _at(north_m: float, east_m: float) -> Coordinate:
    return Coordinate(
        lat=BASE.lat + north_m / M_PER_DEG_LAT, lon=BASE.lon + east_m / M_PER_DEG_LON
    )


def _track(coordinates: list[Coordinate]) -> list[TrackPoint]:
    return [
        TrackPoint(track_id="T1", time=f"{8 + index // 12:02d}:{index % 12 * 5:02d}",
                   coordinate=coordinate)
        for index, coordinate in enumerate(coordinates)
    ]


def _circle(radius_m: float, turns: float, steps_per_turn: int = 12) -> list[Coordinate]:
    steps = round(turns * steps_per_turn)
    return [
        _at(radius_m * math.cos(2 * math.pi * i / steps_per_turn),
            radius_m * math.sin(2 * math.pi * i / steps_per_turn))
        for i in range(steps + 1)
    ]


def test_circling_counts_signed_turns_near_the_base_only():
    turn = _circle(2_000, 1.25)
    assert abs(circling_deg(_track(turn), BASE)) >= 440
    # The opposite direction has the opposite sign.
    assert circling_deg(_track(turn[::-1]), BASE) == -circling_deg(_track(turn), BASE)
    # Going half a turn and coming back cancels out.
    there = _circle(2_000, 0.5)
    assert abs(circling_deg(_track(there + there[::-1]), BASE)) < 1
    # The same turn outside the circling radius is ignored.
    assert circling_deg(_track(_circle(CIRCLING_RADIUS_M + 1_000, 1.5)), BASE) == 0


def test_zone_entries_need_a_clear_exit_between_entries():
    zone = Zone(name="Kuzey Yolu", center=_at(3_000, 0))
    inside, edge, far = _at(3_000, 0), _at(3_000, 1_700), _at(3_000, 2_500)
    # Wobbling just past the 1.5 km edge is one visit; leaving 1 km out is a new one.
    assert zone_entries(_track([inside, edge, inside, edge, inside]), [zone]) == {
        "Kuzey Yolu": 1
    }
    assert zone_entries(_track([inside, far, inside, far, inside]), [zone]) == {
        "Kuzey Yolu": 3
    }
    assert zone_entries(_track([far]), [zone]) == {}


def test_pattern_rules_k8_circling_and_k9_reentry():
    assert score_pattern("T1", "T1", 359, {"Kuzey Yolu": 2}) == []
    rules = score_pattern("D1", "T1", -400, {"Kuzey Yolu": 3})
    assert [(rule.rule_id, rule.points, rule.refs) for rule in rules] == [
        ("K8", 2, ["D1", "T1"]),
        ("K9", 1, ["D1", "T1"]),
    ]
