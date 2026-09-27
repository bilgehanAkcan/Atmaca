"""Operator-uploaded images: stored as JPEG under artifacts/uploads, keyed by ID.

An upload has no capture time, corner coordinates or tracks, so only the
image-only tools (detection and crop inspection) can use it.
"""

from __future__ import annotations

import io
import json
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .loaders import write_artifact
from .settings import Settings

UPLOAD_ID = re.compile(r"^upl_[0-9a-f]{12}$")
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_PIXELS = 40_000_000


class UploadError(ValueError):
    """The bytes are not a usable image."""


@dataclass(frozen=True)
class Upload:
    image_id: str
    path: Path
    width_px: int
    height_px: int
    name: str
    uploaded_at: str


def is_upload_id(image_id: str) -> bool:
    return bool(UPLOAD_ID.match(image_id))


def _directory(settings: Settings) -> Path:
    return settings.artifacts_dir / "uploads"


def save_upload(settings: Settings, data: bytes, name: str = "") -> Upload:
    from PIL import Image, UnidentifiedImageError

    if not data:
        raise UploadError("Bos dosya")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadError(f"Dosya {MAX_UPLOAD_BYTES // (1024 * 1024)} MB sinirini asiyor")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_UPLOAD_PIXELS:
                raise UploadError("Goruntu cozunurlugu cok yuksek")
            rgb = image.convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise UploadError("Dosya bir goruntu olarak okunamadi") from error
    image_id = f"upl_{uuid.uuid4().hex[:12]}"
    directory = _directory(settings)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{image_id}.jpg"
    rgb.save(path, format="JPEG", quality=95)
    upload = Upload(
        image_id=image_id,
        path=path,
        width_px=rgb.width,
        height_px=rgb.height,
        name=Path(name).name[:120],
        uploaded_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    write_artifact(
        directory / f"{image_id}.json",
        {
            "width_px": upload.width_px,
            "height_px": upload.height_px,
            "name": upload.name,
            "uploaded_at": upload.uploaded_at,
        },
    )
    return upload


def find_upload(settings: Settings, image_id: str) -> Upload | None:
    """The stored upload, or None; IDs are validated before touching the disk."""
    if not is_upload_id(image_id):
        return None
    directory = _directory(settings)
    path, meta_path = directory / f"{image_id}.jpg", directory / f"{image_id}.json"
    if not (path.is_file() and meta_path.is_file()):
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return Upload(image_id=image_id, path=path, **meta)
