"""Stable data contracts shared by every BaseGuard layer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Coordinate(Contract):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class ImageMeta(Contract):
    image_id: str
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    capture_time: str
    top_left: Coordinate
    top_right: Coordinate
    bottom_left: Coordinate
    bottom_right: Coordinate


class Zone(Contract):
    name: str
    center: Coordinate


class Detection(Contract):
    det_id: str
    image_id: str
    vehicle_class: Literal["car", "van", "truck", "bus", "unknown"]
    confidence: float | None = Field(default=None, ge=0, le=1)
    bbox_xywh: tuple[float, float, float, float]
    center_px: tuple[float, float]
    coordinate: Coordinate | None = None


class TrackPoint(Contract):
    track_id: str
    time: str
    coordinate: Coordinate


class MotionFeatures(Contract):
    speed_med_ms: float | None = None
    heading_deg: float | None = None
    dist_base_m: dict[str, float] = Field(default_factory=dict)
    approach_rate_ms: float | None = None
    tti_seconds: float | None = None
    stopped_min: int = 0
    state: Literal["yaklasiyor", "uzaklasiyor", "yatay", "duruyor", "bilinmiyor"]


class FieldReport(Contract):
    report_id: str
    time: str
    source: Literal["official", "third_party"]
    text: str
    coordinate: Coordinate | None = None
    zone_name: str | None = None
    claim_type: str = "unknown"
    claimed_vehicle: str | None = None
    claimed_count: int | None = None
    claimed_color: str | None = None
    claimed_motion: Literal["approaching", "departing", "stationary", "moving"] | None = None
    claims_friendly: bool = False


class FiredRule(Contract):
    rule_id: str
    name: str
    points: int
    refs: list[str]


RiskLevel = Literal["DUSUK", "ORTA", "YUKSEK", "BELIRSIZ"]
ReportVerdict = Literal["uyumlu", "celiskili", "ilgisiz", "dogrulanamaz"]


class EvidenceItem(Contract):
    """One fact the agent relies on, tied to an ID returned by a tool."""

    ref_id: str = Field(description="D/T/R/K kimligi ya da image_id")
    source_tool: str
    fact: str


class VehicleOfConcern(Contract):
    det_id: str
    track_id: str | None = None
    risk_level: RiskLevel
    reason: str
    evidence_ids: list[str]


class ReportJudgement(Contract):
    """Agent's report-to-vehicle verdict; report text itself stays untrusted."""

    report_id: str
    time: str
    verdict: ReportVerdict
    reason: str
    related_ids: list[str] = Field(default_factory=list)


class RiskBrief(Contract):
    """Final answer of the tool-calling agent, submitted via `submit_brief`."""

    image_id: str | None = None
    risk_level: RiskLevel
    risk_override_reason: str = Field(
        default="",
        description="compute_risk seviyesinden farkli bir seviye verilirse zorunlu gerekce",
    )
    summary: str
    vehicles_of_concern: list[VehicleOfConcern] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    used_reports: list[ReportJudgement] = Field(
        default_factory=list, description="Kanit olarak kullanilan (uyumlu) raporlar"
    )
    rejected_reports: list[ReportJudgement] = Field(
        default_factory=list,
        description="Celiskili, ilgisiz ya da dogrulanamaz raporlar; her rapor tek listede",
    )
