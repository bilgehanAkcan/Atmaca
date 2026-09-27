"""Weighted Boxes Fusion, matching `ensemble_boxes.weighted_boxes_fusion(conf_type='avg')`.

Stage 1 fused its submission with that library; this is a dependency-free port of
the same algorithm so Stage 2 detections match the Stage 1 ensemble.
"""

from __future__ import annotations

import numpy as np


def _iou(boxes: np.ndarray, box: np.ndarray) -> np.ndarray:
    x1 = np.maximum(boxes[:, 0], box[0])
    y1 = np.maximum(boxes[:, 1], box[1])
    x2 = np.minimum(boxes[:, 2], box[2])
    y2 = np.minimum(boxes[:, 3], box[3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return inter / (area + (box[2] - box[0]) * (box[3] - box[1]) - inter + 1e-12)


def _fused(cluster: list[np.ndarray]) -> np.ndarray:
    """Row layout: [label, score, weight, model, x1, y1, x2, y2]."""
    rows = np.array(cluster)
    scores = rows[:, 1]
    box = np.zeros(8)
    box[0] = rows[0, 0]
    box[1] = scores.sum() / len(rows)
    box[2] = rows[:, 2].sum()
    box[3] = -1
    box[4:] = (scores[:, None] * rows[:, 4:]).sum(axis=0) / scores.sum()
    return box


def weighted_boxes_fusion(
    boxes_list: list[np.ndarray],
    scores_list: list[np.ndarray],
    labels_list: list[np.ndarray],
    weights: list[float] | None = None,
    iou_thr: float = 0.55,
    skip_box_thr: float = 0.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fuse per-model boxes (normalised xyxy in 0-1). Boxes only fuse within a label.

    Returns fused boxes, scores and labels sorted by descending score.
    """
    weights_arr = np.ones(len(boxes_list)) if weights is None else np.asarray(weights, float)
    by_label: dict[int, list[np.ndarray]] = {}
    for model, (boxes, scores, labels) in enumerate(
        zip(boxes_list, scores_list, labels_list, strict=True)
    ):
        for box, score, label in zip(boxes, scores, labels, strict=True):
            if score < skip_box_thr:
                continue
            x1, x2 = sorted((float(np.clip(box[0], 0, 1)), float(np.clip(box[2], 0, 1))))
            y1, y2 = sorted((float(np.clip(box[1], 0, 1)), float(np.clip(box[3], 0, 1))))
            if (x2 - x1) * (y2 - y1) == 0:
                continue
            weight = weights_arr[model]
            by_label.setdefault(int(label), []).append(
                np.array([int(label), score * weight, weight, model, x1, y1, x2, y2])
            )

    fused_all = []
    for rows in by_label.values():
        rows.sort(key=lambda row: -row[1])
        clusters: list[list[np.ndarray]] = []
        fused = np.empty((0, 8))
        for row in rows:
            if len(fused):
                ious = _iou(fused[:, 4:], row[4:])
                best = int(np.argmax(ious))
                if ious[best] > iou_thr:
                    clusters[best].append(row)
                    fused[best] = _fused(clusters[best])
                    continue
            clusters.append([row.copy()])
            fused = np.vstack([fused, row.copy()])
        for index, cluster in enumerate(clusters):
            fused[index, 1] *= min(len(weights_arr), len(cluster)) / weights_arr.sum()
        fused_all.append(fused)

    if not fused_all:
        return np.zeros((0, 4)), np.zeros(0), np.zeros(0)
    merged = np.concatenate(fused_all)
    merged = merged[np.argsort(-merged[:, 1], kind="stable")]
    return merged[:, 4:], merged[:, 1], merged[:, 0]
