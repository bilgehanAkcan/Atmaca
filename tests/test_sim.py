"""Simulation clock, time-filtered scene and their API endpoints."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from baseguard.agent.toolkit import ToolContext
from baseguard.api import create_app
from baseguard.domain import Coordinate, Detection, FieldReport, TrackPoint
from baseguard.io import Settings
from baseguard.reports import ReportLink, link_reports, report_verdict
from baseguard.sim import SceneBuilder, SimClock, vehicle_category

CORNERS = {
    "top_left": [39.9380, 32.8520],
    "top_right": [39.9380, 32.8540],
    "bottom_left": [39.9370, 32.8520],
    "bottom_right": [39.9370, 32.8540],
}


class FakeTime:
    def __init__(self) -> None:
        self.value = 1_000.0

    def __call__(self) -> float:
        return self.value


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    meta = {"width_px": 1000, "height_px": 500, "corner_coordinates": CORNERS}
    (tmp_path / "image_meta.json").write_text(
        json.dumps(
            {
                "img_1": {**meta, "capture_time": "12:00"},
                "img_2": {**meta, "capture_time": "13:00"},
            }
        )
    )
    (tmp_path / "zones.json").write_text(
        json.dumps(
            {
                "base": {"name": "Merkez Us", "lat": 39.92184, "lon": 32.85306},
                "zones": [{"name": "Kuzey Yolu", "center": [39.950586, 32.85306]}],
            }
        )
    )
    rows = ["track_id,time,lat,lon"]
    # T1 drives south towards the base and ends inside img_1 at 12:00.
    for time, lat in zip(
        ["11:45", "11:50", "11:55", "12:00"], [39.9500, 39.9450, 39.9400, 39.9375]
    ):
        rows.append(f"T1,{time},{lat},32.8530")
    # T2 is parked inside img_1.
    rows += [f"T2,{time},39.9372,32.8535" for time in ("11:45", "11:50", "11:55", "12:00")]
    rows += ["T9,12:55,39.9372,32.8531", "T9,13:00,39.9372,32.8531"]
    (tmp_path / "tracks.csv").write_text("\n".join(rows) + "\n")
    (tmp_path / "field_reports.json").write_text(
        json.dumps(
            [
                {"time": "11:30", "source": "third_party", "text": "Kuzey Yolu trafik normal."},
                {"time": "12:30", "source": "official", "text": "Kuzey Yolu bolgesinde kamyon."},
                # Friendly claim of a moving car at T2's spot, but T2 is parked.
                {
                    "time": "11:55",
                    "source": "official",
                    "text": "39.9372N 32.8535E konumundan usse dogru ilerleyen otomobil "
                    "planli ikmal aracidir.",
                },
            ]
        )
    )
    return Settings(data_dir=tmp_path, detector_weights=(tmp_path / "missing.pt",))


def test_clock_advances_only_while_running_and_stops_at_day_end():
    now = FakeTime()
    clock = SimClock(rate=60.0, now=now)
    now.value += 30
    assert clock.snapshot()["time"] == "08:00"

    clock.update(running=True)
    now.value += 90  # 90 s at 60x = 90 sim minutes
    assert clock.snapshot()["time"] == "09:30"

    clock.update(rate=1.0)
    now.value += 120
    assert clock.snapshot()["time"] == "09:32"

    clock.update(time_hhmm="15:59")
    now.value += 600
    snapshot = clock.snapshot()
    assert snapshot["time"] == "16:00" and snapshot["running"] is False


def test_clock_rejects_out_of_range_values():
    clock = SimClock()
    with pytest.raises(ValueError):
        clock.update(time_hhmm="07:59")
    with pytest.raises(ValueError):
        clock.update(rate=7.0)


def test_vehicle_category_marks_untracked_and_positive_score_red():
    assert vehicle_category("T1", 0, [])[0] == 1
    assert vehicle_category(None, 0, [])[0] == 2
    assert vehicle_category("T1", 2, ["K1"]) == (2, ["K1"])
    # A consistent friendly report (K6, -1) alone keeps a tracked vehicle green.
    assert vehicle_category("T1", 0, ["K6"]) == (1, ["K6"])


def test_scene_tracks_vehicles_without_future_data(settings):
    context = ToolContext(settings=settings)
    builder = SceneBuilder(context)

    assert builder.scene("11:40")["vehicles"] == []

    early = {item["id"]: item for item in builder.scene("11:50")["vehicles"]}
    assert set(early) == {"T1", "T2"}
    # img_1 (12:00) is still in the future: no class, no detection, no rule yet.
    assert len(early["T1"]["points"]) == 2 and early["T1"]["observations"] == []
    assert early["T1"]["cls"] == "unknown" and early["T1"]["category"] == 1

    noon = {item["id"]: item for item in builder.scene("12:00")["vehicles"]}
    seen = noon["T1"]["observations"][0]
    assert seen["image_id"] == "img_1" and seen["bbox_xywh"] and seen["corners"]
    # Pixel centre -> lat/lon uses the corner formula; T1 ends at 39.9375 N.
    assert seen["lat"] == pytest.approx(39.9375, abs=1e-6)
    assert noon["T1"]["category"] == 2 and noon["T1"]["rule_ids"] == ["K1"]
    assert noon["T1"]["score"] == 2 and noon["T1"]["risk_level"] == "ORTA"
    assert noon["T2"]["state"] == "duruyor"

    # Before 11:55 the friendly report does not exist yet, so parked T2 is green.
    assert early["T2"]["category"] == 1 and early["T2"]["reports"] == []
    # Afterwards it contradicts T2 (claims an approaching car): K5 +3 turns it red.
    assert noon["T2"]["rule_ids"] == ["K5"] and noon["T2"]["score"] == 3
    assert noon["T2"]["category"] == 2
    assert [(r["report_id"], r["verdict"]) for r in noon["T2"]["reports"]] == [
        ("R003", "celiskili")
    ]
    assert any("R003" in reason for reason in noon["T2"]["reasons"])

    lingering = {item["id"]: item for item in builder.scene("12:30")["vehicles"]}
    assert lingering["T1"]["stale_min"] == 30
    assert "T1" not in {item["id"] for item in builder.scene("12:31")["vehicles"]}


def _report(text: str, **claims) -> FieldReport:
    return FieldReport(report_id="R1", time="12:00", source="official", text=text, **claims)


def test_report_verdict_checks_class_and_motion_only():
    here = Coordinate(lat=39.9372, lon=32.8535)
    stopped_truck = _report(
        "kamyon durdugu", coordinate=here, claimed_vehicle="truck", claimed_motion="stationary"
    )
    link = ReportLink(stopped_truck, "duruyor", 5.0)
    assert report_verdict(link, "truck") == "uyumlu"
    assert report_verdict(link, "car") == "celiskili"  # wrong class
    assert report_verdict(ReportLink(stopped_truck, "yaklasiyor", 5.0), "truck") == "celiskili"
    # Class unknown and motion unknown: nothing left to check.
    assert report_verdict(ReportLink(stopped_truck, "bilinmiyor", 5.0), "unknown") == (
        "dogrulanamaz"
    )
    # Colour is not checkable from tracks/detections.
    red_car = _report("kirmizi otomobil", coordinate=here, claimed_color="kirmizi")
    assert report_verdict(ReportLink(red_car, "duruyor", 5.0), "truck") == "dogrulanamaz"
    # "No heavy traffic in zone X" is contradicted only by a moving truck/bus there.
    denial = _report(
        "agir arac hareketi yok", zone_name="Kuzey Yolu", claim_type="no_activity",
        claimed_vehicle="heavy",
    )
    assert report_verdict(ReportLink(denial, "yatay", 800.0), "bus") == "celiskili"
    assert report_verdict(ReportLink(denial, "duruyor", 800.0), "bus") == "ilgisiz"
    assert report_verdict(ReportLink(denial, "yatay", 800.0), "car") == "ilgisiz"


def test_link_reports_uses_nearest_tracks_up_to_the_report_time():
    base = Coordinate(lat=39.92184, lon=32.85306)
    tracks = {
        "NEAR": [TrackPoint(track_id="NEAR", time="11:55", coordinate=Coordinate(
            lat=39.9372, lon=32.8535))],
        "NEXT": [TrackPoint(track_id="NEXT", time="11:55", coordinate=Coordinate(
            lat=39.9373, lon=32.8535))],
        "LATE": [TrackPoint(track_id="LATE", time="12:05", coordinate=Coordinate(
            lat=39.9372, lon=32.8535))],
    }
    one = _report("x", coordinate=Coordinate(lat=39.9372, lon=32.8535))
    assert list(link_reports([one], tracks, base, [])) == ["NEAR"]
    two = one.model_copy(update={"claimed_count": 2})
    assert sorted(link_reports([two], tracks, base, [])) == ["NEAR", "NEXT"]


def test_untracked_detection_is_a_static_red_vehicle(settings):
    context = ToolContext(settings=settings)
    # Far from T9's end point, so it cannot be matched to any track.
    context.detections["img_2"] = [
        Detection(det_id="D1", image_id="img_2", vehicle_class="truck", confidence=0.8,
                  bbox_xywh=(100, 100, 30, 12), center_px=(100, 100))
    ]
    context.detection_source["img_2"] = "yolo_ensemble"
    builder = SceneBuilder(context)

    assert [item["id"] for item in builder.scene("12:59")["vehicles"]] == ["T9"]
    static = next(item for item in builder.scene("13:00")["vehicles"] if item["kind"] == "static")
    assert static["id"] == "img_2/D1" and static["cls"] == "truck"
    assert static["category"] == 2 and static["observations"][0]["det_id"] == "D1"


def test_api_clock_scene_and_filtered_images(settings):
    client = TestClient(create_app(settings, model_factory=lambda _: None))

    assert client.get("/api/clock").json()["time"] == "08:00"
    updated = client.post("/api/clock", json={"time": "12:30", "rate": 10})
    assert updated.status_code == 200 and updated.json()["time"] == "12:30"
    assert client.post("/api/clock", json={"time": "25:00"}).status_code == 422

    # Without `until` the scene follows the server clock.
    assert client.get("/api/scene").json()["images_visible"] == 1
    assert client.get("/api/scene", params={"until": "13:00"}).json()["images_visible"] == 2
    images = client.get("/api/images", params={"until": "12:59"}).json()
    assert [item["image_id"] for item in images] == ["img_1"]


def test_chat_refuses_image_from_the_future(settings):
    client = TestClient(create_app(settings, model_factory=lambda _: None))

    response = client.post(
        "/api/chat", json={"message": "Durum?", "image_id": "img_2", "sim_time": "12:30"}
    )

    assert response.status_code == 409