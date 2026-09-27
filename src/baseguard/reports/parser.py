"""Parse untrusted field reports into constrained, reviewable claims."""

from __future__ import annotations

import re

from baseguard.domain import Coordinate, FieldReport, Zone

COORDINATE = re.compile(r"(\d{2}\.\d+)\s*N\s+(\d{2}\.\d+)\s*E", re.IGNORECASE)
VEHICLE_WORDS = {
    "kamyon": "truck",
    "otomobil": "car",
    "panelvan": "van",
    "otobus": "bus",
    "agir arac": "heavy",
    "arac": "vehicle",
}
_VEHICLE = "|".join(VEHICLE_WORDS)
# Suffixes are allowed: "5 kamyonun", "2 kamyon".
COUNT = re.compile(rf"\b(\d+|bir)\s+(?:araclik\s+bir\s+)?({_VEHICLE})\w*")
VEHICLE = re.compile(rf"\b({_VEHICLE})\w*")
COLORS = ("kirmizi", "mavi", "sari", "beyaz", "siyah", "gri", "yesil")
MOTION_CUES = (
    ("approaching", ("usse dogru", "usse gelen")),
    ("departing", ("uzaklasiyor",)),
    (
        "stationary",
        ("hareketsiz", "durdugu", "park halinde", "yerinden ayrilmadi", "beklemede",
         "bekliyor"),
    ),
    ("moving", ("ilerliyor", "transit", "geciyor", "hareketleri olagan")),
)
FRIENDLY_CUES = (
    "dost", "bize bagli", "planli ikmal", "kimlik teyidi", "teyitli", "lojistik konvoy",
)
NO_ACTIVITY_CUES = (
    "hareketi yok", "bulunmuyor", "olagandisi bir durum bildirmedi", "normal seyrediyor",
)


def enrich_report(report: FieldReport, zones: list[Zone]) -> FieldReport:
    """Extract deterministic metadata; the report body remains untrusted data.

    Zone-only reports keep ``coordinate=None``; they are matched by zone name.
    """
    text = report.text.casefold()
    coordinate_match = COORDINATE.search(report.text)
    coordinate = (
        Coordinate(
            lat=float(coordinate_match.group(1)), lon=float(coordinate_match.group(2))
        )
        if coordinate_match
        else None
    )
    zone_name = next(
        (zone.name for zone in zones if zone.name.casefold() in text), None
    )
    count_match = COUNT.search(text)
    vehicle_match = count_match.group(2) if count_match else None
    if vehicle_match is None:
        found = VEHICLE.search(text)
        vehicle_match = found.group(1) if found else None
    count = None
    if count_match:
        count = 1 if count_match.group(1) == "bir" else int(count_match.group(1))
    motion = next(
        (label for label, cues in MOTION_CUES if any(cue in text for cue in cues)),
        None,
    )
    friendly = any(cue in text for cue in FRIENDLY_CUES)
    if friendly:
        claim_type = "friendly"
    elif any(cue in text for cue in NO_ACTIVITY_CUES):
        claim_type = "no_activity"
    elif motion == "stationary":
        claim_type = "stopped"
    elif motion == "approaching":
        claim_type = "approaching"
    elif count is not None:
        claim_type = "vehicle_count"
    elif coordinate or zone_name:
        claim_type = "presence"
    else:
        claim_type = "context"
    return report.model_copy(
        update={
            "coordinate": coordinate,
            "zone_name": zone_name,
            "claim_type": claim_type,
            "claimed_vehicle": VEHICLE_WORDS.get(vehicle_match) if vehicle_match else None,
            "claimed_count": count,
            "claimed_color": next((color for color in COLORS if color in text), None),
            "claimed_motion": motion,
            "claims_friendly": friendly,
        }
    )
