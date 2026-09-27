"""WBF port and per-vehicle merge; no model weights needed."""

import numpy as np
import pytest

from baseguard.perception import FusedBoxes, vehicles_from_fused
from baseguard.perception.wbf import weighted_boxes_fusion

BOX = [0.10, 0.10, 0.20, 0.20]


def _arrays(*rows):
    boxes = np.array([row[0] for row in rows], float).reshape(-1, 4)
    return boxes, np.array([row[1] for row in rows]), np.array([row[2] for row in rows])


def test_agreeing_models_average_boxes_and_scores():
    first = _arrays((BOX, 0.9, 0))
    second = _arrays(([0.12, 0.10, 0.22, 0.20], 0.7, 0))

    boxes, scores, labels = weighted_boxes_fusion(
        [first[0], second[0]], [first[1], second[1]], [first[2], second[2]],
        weights=[1, 1], iou_thr=0.55,
    )

    assert len(boxes) == 1 and labels[0] == 0
    assert scores[0] == pytest.approx(0.8)
    assert boxes[0][0] == pytest.approx((0.9 * 0.10 + 0.7 * 0.12) / 1.6)


def test_box_seen_by_one_model_is_down_weighted():
    only = _arrays((BOX, 0.8, 0))
    empty = (np.zeros((0, 4)), np.zeros(0), np.zeros(0))

    _, scores, _ = weighted_boxes_fusion(
        [only[0], empty[0]], [only[1], empty[1]], [only[2], empty[2]], weights=[1, 1]
    )

    assert scores[0] == pytest.approx(0.4)


def test_different_classes_and_distant_boxes_stay_separate():
    model = _arrays((BOX, 0.9, 0), (BOX, 0.5, 1), ([0.6, 0.6, 0.7, 0.7], 0.8, 0))

    _, scores, labels = weighted_boxes_fusion([model[0]], [model[1]], [model[2]])

    assert sorted(zip(labels.tolist(), scores.tolist())) == [(0, 0.8), (0, 0.9), (1, 0.5)]


def test_multi_label_twins_become_one_vehicle_with_alternative_class():
    fused = FusedBoxes(
        boxes=np.array([[100, 100, 140, 120], [101, 100, 141, 121], [300, 300, 340, 320]], float),
        scores=np.array([0.67, 0.31, 0.2]),
        labels=np.array([1, 0, 0]),
    )

    vehicles = vehicles_from_fused("img", fused, confidence=0.25)

    assert len(vehicles) == 1  # the 0.2 box is below the threshold
    assert vehicles[0].detection.vehicle_class == "van"
    assert (vehicles[0].alt_cls, vehicles[0].alt_conf) == ("car", 0.31)
    assert vehicles[0].detection.center_px == (120.0, 110.0)
