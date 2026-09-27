"""Auditable rules for the deterministic base risk level."""

from baseguard.domain.models import FiredRule, MotionFeatures


def score_vehicle(
    det_id: str, vehicle_class: str, track_id: str | None, motion: MotionFeatures | None
) -> list[FiredRule]:
    if motion is None:
        return []
    refs = [det_id] + ([track_id] if track_id else [])
    rules: list[FiredRule] = []
    current_distance = motion.dist_base_m.get("t0", float("inf"))
    if (
        current_distance <= 2_000
        and motion.approach_rate_ms is not None
        and motion.approach_rate_ms > 0.5
    ):
        rules.append(
            FiredRule(
                rule_id="K1", name="2 km içinde yaklaşan araç", points=2, refs=refs
            )
        )
        if vehicle_class in {"truck", "bus"}:
            rules.append(
                FiredRule(rule_id="K2", name="yaklaşan ağır araç", points=1, refs=refs)
            )
    if vehicle_class in {"truck", "bus"} and motion.stopped_min >= 60:
        rules.append(
            FiredRule(
                rule_id="K3", name="uzun süre duran ağır araç", points=1, refs=refs
            )
        )
    return rules


CIRCLING_MIN_DEG = 360
REENTRY_MIN_ENTRIES = 3  # the first entry plus at least two returns


def score_pattern(
    det_id: str, track_id: str, circling_deg: float, zone_entries: dict[str, int]
) -> list[FiredRule]:
    """Rules on the shape of the route so far: circling the base, re-entering a zone."""
    refs = [det_id] + ([track_id] if track_id != det_id else [])
    rules: list[FiredRule] = []
    if abs(circling_deg) >= CIRCLING_MIN_DEG:
        rules.append(
            FiredRule(rule_id="K8", name="üs çevresinde tur atan araç", points=2, refs=refs)
        )
    if any(count >= REENTRY_MIN_ENTRIES for count in zone_entries.values()):
        rules.append(
            FiredRule(
                rule_id="K9", name="aynı bölgeye tekrar tekrar giren araç", points=1,
                refs=refs,
            )
        )
    return rules


def score_report_verdict(
    report_id: str, claims_friendly: bool, verdict: str, refs: list[str]
) -> list[FiredRule]:
    """Rules driven by the agent's report-to-vehicle verdict."""
    refs = [report_id, *refs]
    if claims_friendly and verdict == "celiskili":
        return [
            FiredRule(
                rule_id="K5", name="dost/planlı iddiası tespitle çelişiyor", points=3,
                refs=refs,
            )
        ]
    if claims_friendly and verdict == "uyumlu":
        return [
            FiredRule(
                rule_id="K6", name="dost/planlı iddiası tespitle uyumlu", points=-1,
                refs=refs,
            )
        ]
    if verdict == "celiskili":
        return [
            FiredRule(
                rule_id="K7", name="rapor iddiası tespitle çelişiyor", points=1, refs=refs
            )
        ]
    return []


def unmatched_track_rule(track_ids: list[str]) -> list[FiredRule]:
    if not track_ids:
        return []
    return [
        FiredRule(
            rule_id="K4",
            name="footprint içinde biten track tespitle eşleşmedi",
            points=1,
            refs=track_ids,
        )
    ]


def total_points(rules: list[FiredRule]) -> int:
    """Sum of rule points; a friendly claim (K6) never zeroes a positive risk."""
    raw = sum(rule.points for rule in rules)
    positive = sum(rule.points for rule in rules if rule.points > 0)
    return max(raw, 1) if positive > 0 else max(raw, 0)


def image_level(score: int) -> str:
    """Three-level scale used by the map and the agent's compute_risk tool."""
    if score >= 4:
        return "YUKSEK"
    return "ORTA" if score >= 2 else "DUSUK"
