"""Run the detector ensemble on every image once and cache the fused boxes.

    python scripts/precompute_detections.py

Also prints how well detections line up with the tracks ending at capture time,
which is the quickest sanity check of the detector on Stage 2 imagery.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from baseguard.agent import handlers
from baseguard.agent.toolkit import DetectVehiclesInput, MatchTracksInput, ToolContext
from baseguard.io import get_settings


def main() -> None:
    settings = get_settings()
    if not handlers.weights_available(settings):
        raise SystemExit(f"Weights missing: {[str(p) for p in settings.detector_weights]}")
    context = ToolContext(settings=settings)
    totals = {"vehicles": 0, "matched": 0, "untracked": 0, "missed_tracks": 0}
    for image_id in sorted(context.data.meta):
        started = time.perf_counter()
        detected = handlers.detect_vehicles(context, DetectVehiclesInput(image_id=image_id))
        matched = handlers.match_tracks(context, MatchTracksInput(image_id=image_id))
        distances = [item["match_dist_m"] for item in matched["matches"]]
        row = {
            "vehicles": detected["count"],
            "matched": len(distances),
            "untracked": len(matched["unmatched_detections"]),
            "missed_tracks": len(matched["unmatched_tracks"]),
        }
        for key, value in row.items():
            totals[key] += value
        worst = f"{max(distances):.1f} m" if distances else "-"
        print(
            f"{image_id}  {time.perf_counter() - started:5.1f}s  araç {row['vehicles']:2d}  "
            f"eşleşen {row['matched']:2d} (en uzak {worst})  izsiz {row['untracked']:2d}  "
            f"kaçırılan track {row['missed_tracks']:2d}"
        )
    print("TOPLAM", totals)


if __name__ == "__main__":
    main()
