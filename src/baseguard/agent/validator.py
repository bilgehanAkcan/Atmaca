"""Code-level grounding checks for LLM briefs."""

import re
from typing import Any

from baseguard.domain import RiskBrief

EVIDENCE_ID = re.compile(r"^[DTRK]\d+$")


def collect_evidence_ids(value: Any) -> set[str]:
    """Every D/T/R/K ID that appears anywhere in a tool result."""
    if isinstance(value, dict):
        return collect_evidence_ids(list(value.values()))
    if isinstance(value, list):
        return set().union(*(collect_evidence_ids(item) for item in value))
    return {value} if isinstance(value, str) and EVIDENCE_ID.match(value) else set()


def validate_risk_brief(
    brief: RiskBrief, known_ids: set[str], computed_level: str | None
) -> None:
    """Reject IDs no tool returned and unexplained deviations from compute_risk."""
    cited = {item.ref_id for item in brief.evidence}
    for vehicle in brief.vehicles_of_concern:
        cited |= {vehicle.det_id, *vehicle.evidence_ids}
        if vehicle.track_id:
            cited.add(vehicle.track_id)
    for report in brief.used_reports + brief.rejected_reports:
        cited |= {report.report_id, *report.related_ids}
    judged = [item.report_id for item in brief.used_reports + brief.rejected_reports]
    repeated = sorted({item for item in judged if judged.count(item) > 1})
    if repeated:
        raise ValueError(
            f"Each report must appear once in used_reports or rejected_reports: {repeated}"
        )
    # The image ID comes from the operator's question, not from tool evidence.
    cited.discard(brief.image_id)
    unknown = cited - known_ids
    if unknown:
        raise ValueError(
            f"Brief cites IDs that no tool returned: {sorted(unknown)}. "
            "Use only IDs from tool results."
        )
    if (
        computed_level is not None
        and brief.risk_level != computed_level
        and not brief.risk_override_reason.strip()
    ):
        raise ValueError(
            f"risk_level {brief.risk_level} differs from compute_risk level "
            f"{computed_level}; risk_override_reason is required."
        )

