"""Stage 1 detector ensemble adapter."""

from .detector import EnsembleDetection, FusedBoxes, fuse_image, vehicles_from_fused

__all__ = ["EnsembleDetection", "FusedBoxes", "fuse_image", "vehicles_from_fused"]
