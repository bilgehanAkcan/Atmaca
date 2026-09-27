"""Stage 1 detector: two YOLO11m models x three sizes, fused with WBF.

Mirrors the "ensemble esit" configuration of the Stage 1 notebook
(yolo11_1408.ipynb, val mAP50 0.841): every model predicts at every size with
conf=0.001, NMS IoU 0.6 and multi-label NMS; WBF with equal weights and IoU 0.65;
boxes smaller than 180 px² are dropped.

Stage 2 then needs one detection per vehicle, so multi-label duplicates (the same
vehicle as car and van) are merged; the runner-up class is kept as `alt_cls`.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from baseguard.domain import Detection

from .wbf import _iou, weighted_boxes_fusion

CLASSES = ("car", "van", "truck", "bus")
PREDICT_CONF = 0.001
NMS_IOU = 0.6
MAX_DET = 1000
WBF_IOU = 0.65
AREA_MIN_PX = 180
# Multi-label twins of one vehicle overlap almost fully; parked neighbours do not.
DUPLICATE_IOU = 0.7

_PREDICT_LOCK = threading.Lock()


@dataclass(frozen=True)
class EnsembleDetection:
    detection: Detection
    alt_cls: str | None
    alt_conf: float | None


@lru_cache(maxsize=4)
def _load_model(weights: str):
    from ultralytics import YOLO

    model = YOLO(weights)
    if tuple(model.names.values()) != CLASSES:
        raise ValueError(f"{weights}: unexpected classes {model.names}")
    return model


def default_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "0"
    return "mps" if torch.backends.mps.is_available() else "cpu"


@contextmanager
def _multi_label_nms():
    """Keep both class hypotheses for ambiguous vehicles, as in Stage 1."""
    from ultralytics.utils import nms

    original = nms.non_max_suppression

    def patched(*args, **kwargs):
        kwargs["multi_label"] = True
        return original(*args, **kwargs)

    nms.non_max_suppression = patched
    try:
        yield
    finally:
        nms.non_max_suppression = original


def _predict(model, image_path: Path, size: int, device: str):
    result = model.predict(
        str(image_path), imgsz=size, conf=PREDICT_CONF, iou=NMS_IOU, max_det=MAX_DET,
        device=device, verbose=False,
    )[0]
    height, width = result.orig_shape
    boxes = result.boxes
    return (
        np.clip(boxes.xyxy.cpu().numpy() / [width, height, width, height], 0, 1),
        boxes.conf.cpu().numpy(),
        boxes.cls.cpu().numpy(),
        (width, height),
    )


def _merge_duplicates(boxes: np.ndarray, scores: np.ndarray, labels: np.ndarray):
    """Greedy class-agnostic merge; returns (index, alt_index | None) pairs."""
    order = np.argsort(-scores, kind="stable")
    kept: list[tuple[int, int | None]] = []
    for index in order:
        if kept:
            ious = _iou(boxes[[k for k, _ in kept]], boxes[index])
            best = int(np.argmax(ious))
            if ious[best] >= DUPLICATE_IOU:
                keeper, alt = kept[best]
                if alt is None and labels[index] != labels[keeper]:
                    kept[best] = (keeper, int(index))
                continue
        kept.append((int(index), None))
    return kept


@dataclass(frozen=True)
class FusedBoxes:
    """Ensemble output before the confidence threshold: pixel xyxy, score, class index."""

    boxes: np.ndarray
    scores: np.ndarray
    labels: np.ndarray

    def to_json(self) -> dict:
        return {
            "boxes": np.round(self.boxes, 2).tolist(),
            "scores": np.round(self.scores, 5).tolist(),
            "labels": self.labels.astype(int).tolist(),
        }

    @classmethod
    def from_json(cls, payload: dict) -> FusedBoxes:
        return cls(
            boxes=np.asarray(payload["boxes"], float).reshape(-1, 4),
            scores=np.asarray(payload["scores"], float),
            labels=np.asarray(payload["labels"], int),
        )


def fuse_image(
    image_path: Path,
    weights: tuple[Path, ...],
    sizes: tuple[int, ...],
    device: str | None = None,
) -> FusedBoxes:
    """Every model at every size, WBF, area filter. Slow: cache the result."""
    missing = [str(path) for path in weights if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Detector weights are missing: {missing}")
    device = device or default_device()
    passes = []
    with _PREDICT_LOCK, _multi_label_nms():
        for path in weights:
            model = _load_model(str(path))
            for size in sizes:
                passes.append(_predict(model, image_path, size, device))
    width, height = passes[0][3]
    boxes, scores, labels = weighted_boxes_fusion(
        [item[0] for item in passes],
        [item[1] for item in passes],
        [item[2] for item in passes],
        weights=[1] * len(passes),
        iou_thr=WBF_IOU,
        skip_box_thr=PREDICT_CONF,
    )
    boxes = boxes * [width, height, width, height]
    keep = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]) >= AREA_MIN_PX
    return FusedBoxes(boxes[keep], scores[keep], labels[keep].astype(int))


def vehicles_from_fused(
    image_id: str, fused: FusedBoxes, confidence: float
) -> list[EnsembleDetection]:
    """Threshold fused boxes and keep one detection per vehicle."""
    keep = fused.scores >= confidence
    boxes, scores, labels = fused.boxes[keep], fused.scores[keep], fused.labels[keep]
    detections = []
    for number, (index, alt) in enumerate(_merge_duplicates(boxes, scores, labels), start=1):
        x1, y1, x2, y2 = boxes[index].tolist()
        center = (x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2)
        detections.append(
            EnsembleDetection(
                detection=Detection(
                    det_id=f"D{number}",
                    image_id=image_id,
                    vehicle_class=CLASSES[labels[index]],
                    confidence=round(float(scores[index]), 4),
                    bbox_xywh=(*center, x2 - x1, y2 - y1),
                    center_px=center,
                ),
                alt_cls=CLASSES[labels[alt]] if alt is not None else None,
                alt_conf=round(float(scores[alt]), 4) if alt is not None else None,
            )
        )
    return detections
