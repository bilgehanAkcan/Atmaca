"""Tool handlers on a tiny synthetic data package (no real data or weights)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from baseguard.agent import handlers
from baseguard.agent.handlers import ToolError
from baseguard.agent.toolkit import (
    AnalyzeTrackInput,
    ComputeRiskInput,
    DetectVehiclesInput,
    GetImageContextInput,
    MatchTracksInput,
    PixelToGeoInput,
    RiskReportVerdict,
    RiskVehicle,
    SearchReportsInput,
    ToolContext,
)
from baseguard.io import Settings

BASE = (39.92184, 32.85306)
# 1000x500 px image, ~170 m x ~110 m, about 1.7 km north of the base.
CORNERS = {
    "top_left": [39.9380, 32.8520],
    "top_right": [39.9380, 32.8540],
    "bottom_left": [39.9370, 32.8520],
    "bottom_right": [39.9370, 32.8540],
}


@pytest.fixture
def context(tmp_path: Path) -> ToolContext:
    (tmp_path / "image_meta.json").write_text(
        json.dumps(
            {
                "img_1": {
                    "width_px": 1000,
                    "height_px": 500,
                    "capture_time": "12:00",
                    "corner_coordinates": CORNERS,
                }
            }
        )
    )
    (tmp_path / "zones.json").write_text(
        json.dumps(
            {
                "base": {"name": "Merkez Us", "lat": BASE[0], "lon": BASE[1]},
                "zones": [{"name": "Kuzey Yolu", "center": [39.950586, 32.85306]}],
            }
        )
    )
    rows = ["track_id,time,lat,lon"]
    # T1 drives south towards the base and ends inside the image.
    for time, lat in zip(
        ["11:45", "11:50", "11:55", "12:00"], [39.9500, 39.9450, 39.9400, 39.9375]
    ):
        rows.append(f"T1,{time},{lat},32.8530")
    # T2 is parked inside the image the whole time.
    rows += [f"T2,11:{minute},39.9372,32.8535" for minute in (45, 50, 55)]
    rows.append("T2,12:00,39.9372,32.8535")
    # T3 ends at capture time far outside the image.
    rows += ["T3,11:55,39.9000,32.8000", "T3,12:00,39.9001,32.8000"]
    (tmp_path / "tracks.csv").write_text("\n".join(rows) + "\n")
    (tmp_path / "field_reports.json").write_text(
        json.dumps(
            [
                {
                    "time": "11:40",
                    "source": "official",
                    "text": "39.9375N 32.8530E konumundan usse dogru ilerleyen otomobil "
                    "planli ikmal aracidir, kimlik teyidi yapilmistir.",
                },
                {
                    "time": "11:30",
                    "source": "third_party",
                    "text": "Kuzey Yolu bolgesinde trafik akisi normal seyrediyor.",
                },
                {"time": "11:50", "source": "official", "text": "Hava acik."},
                {"time": "09:00", "source": "official", "text": "Eski rapor 39.9375N 32.8530E."},
            ]
        )
    )
    settings = Settings(data_dir=tmp_path, detector_weights=(tmp_path / "missing.pt",))
    return ToolContext(settings=settings)


def test_image_context_reports_footprint_and_base_distance(context):
    result = handlers.get_image_context(context, GetImageContextInput(image_id="img_1"))

    assert result["capture_time"] == "12:00"
    assert 1_600 < result["dist_to_base_m"] < 1_800
    assert result["footprint"]["gsd_cm"] == pytest.approx(17.1, abs=0.2)


def test_unknown_image_lists_known_ids(context):
    with pytest.raises(ToolError) as error:
        handlers.get_image_context(context, GetImageContextInput(image_id="img_x"))

    assert error.value.payload["known_image_ids"] == ["img_1"]


def test_track_proxy_detections_are_labelled_and_match(context):
    detected = handlers.detect_vehicles(context, DetectVehiclesInput(image_id="img_1"))
    geo = handlers.pixel_to_geo(context, PixelToGeoInput(image_id="img_1"))
    matched = handlers.match_tracks(context, MatchTracksInput(image_id="img_1"))

    assert detected["source"] == "track_proxy" and "warning" in detected
    assert detected["count"] == 2  # T3 ends outside the footprint
    assert geo["detections"][0]["lat"] == pytest.approx(39.9375, abs=1e-6)
    assert {item["track_id"] for item in matched["matches"]} == {"T1", "T2"}
    assert matched["unmatched_tracks"] == []


def test_match_tracks_runs_detection_when_called_first(context):
    matched = handlers.match_tracks(context, MatchTracksInput(image_id="img_1"))

    assert len(matched["matches"]) == 2


def test_analyze_track_labels_approach_and_parking(context):
    result = handlers.analyze_track(
        context, AnalyzeTrackInput(track_ids=["T1", "T2", "T9"])
    )
    profiles = {item["track_id"]: item for item in result["tracks"]}

    assert profiles["T1"]["state"] == "yaklasiyor"
    assert profiles["T2"]["behavior"] == "park_halinde"
    assert result["unknown_track_ids"] == ["T9"]


def test_search_reports_groups_by_location_zone_and_general(context):
    result = handlers.search_reports(
        context, SearchReportsInput(time="12:00", lat=39.9375, lon=32.8530)
    )

    assert [item["report_id"] for item in result["by_location"]] == ["R001"]
    assert result["by_location"][0]["claim"]["friendly"] is True
    assert [item["report_id"] for item in result["by_zone"]] == ["R002"]
    assert [item["report_id"] for item in result["general"]] == ["R003"]


def test_contradicted_friendly_claim_raises_risk(context):
    matched = handlers.match_tracks(context, MatchTracksInput(image_id="img_1"))
    approaching = next(m["det_id"] for m in matched["matches"] if m["track_id"] == "T1")
    vehicles = [RiskVehicle(det_id=m["det_id"]) for m in matched["matches"]]

    plain = handlers.compute_risk(
        context, ComputeRiskInput(image_id="img_1", vehicles=vehicles)
    )
    contradicted = handlers.compute_risk(
        context,
        ComputeRiskInput(
            image_id="img_1",
            vehicles=vehicles,
            report_verdicts=[
                RiskReportVerdict(
                    report_id="R001", verdict="celiskili", related_det_ids=[approaching]
                )
            ],
        ),
    )

    assert plain["image_risk"] == "ORTA"  # K1: approaching within 2 km
    assert contradicted["image_risk"] == "YUKSEK"  # + K5
    top = contradicted["vehicle_risk"][0]
    assert {rule["rule_id"] for rule in top["factors"]} == {"K1", "K5"}
