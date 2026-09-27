"""HTTP boundary for the operator UI: image data and a streaming agent chat.

Run with:  uvicorn --factory baseguard.api.app:create_app --port 8000
API keys stay in this process; the UI never sees them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from baseguard.agent import BaseGuardAgent, create_chat_model, handlers
from baseguard.agent.handlers import ToolError
from baseguard.agent.toolkit import (
    GetImageContextInput,
    MatchTracksInput,
    ToolContext,
)
from baseguard.io.settings import Settings, get_settings
from baseguard.io.uploads import MAX_UPLOAD_BYTES, UploadError, find_upload, save_upload
from baseguard.sim import SceneBuilder, SimClock, to_minutes

# Vite dev server and Electron's file:// renderer (sends Origin: null).
UI_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "null"]
MAX_SESSIONS = 20
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"

logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    session_id: str | None = None
    image_id: str | None = None
    # Sim clock value on the operator screen; the agent must not use later data.
    sim_time: str | None = Field(default=None, pattern=HHMM)


class ClockUpdate(BaseModel):
    time: str | None = Field(default=None, pattern=HHMM)
    running: bool | None = None
    rate: float | None = None


class _Session:
    def __init__(self, agent: BaseGuardAgent) -> None:
        self.agent = agent
        self.lock = threading.Lock()


def _sse(event: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {data}\n\n"


def create_app(
    settings: Settings | None = None,
    model_factory: Callable[[Settings], Any] = create_chat_model,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="BaseGuard", version="0.2.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=UI_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    # Read-only context for the UI's image endpoints; chat sessions get their own.
    shared = ToolContext(settings=settings)
    clock = SimClock()
    scene_builder = SceneBuilder(shared)
    sessions: OrderedDict[str, _Session] = OrderedDict()
    sessions_lock = threading.Lock()
    model_holder: dict[str, Any] = {}

    def session_for(session_id: str | None) -> tuple[str, _Session]:
        with sessions_lock:
            if session_id and session_id in sessions:
                sessions.move_to_end(session_id)
                return session_id, sessions[session_id]
            if "model" not in model_holder:
                model_holder["model"] = model_factory(settings)
            new_id = uuid.uuid4().hex
            sessions[new_id] = _Session(BaseGuardAgent(model_holder["model"], settings))
            while len(sessions) > MAX_SESSIONS:
                sessions.popitem(last=False)
            return new_id, sessions[new_id]

    def image_context(image_id: str) -> dict:
        try:
            return handlers.get_image_context(shared, GetImageContextInput(image_id=image_id))
        except ToolError as error:
            raise HTTPException(status_code=404, detail=error.payload["detail"]) from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "llm_provider": settings.llm_provider,
            "llm_configured": bool(
                settings.groq_api_key
                if settings.llm_provider == "groq"
                else settings.glm_base_url and settings.glm_api_key
            ),
            "detector": (
                handlers.ENSEMBLE_SOURCE if handlers.weights_available(settings) else "track_proxy"
            ),
        }

    @app.get("/api/clock")
    def get_clock() -> dict:
        return clock.snapshot()

    @app.post("/api/clock")
    def set_clock(update: ClockUpdate) -> dict:
        try:
            return clock.update(time_hhmm=update.time, running=update.running, rate=update.rate)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.get("/api/scene")
    def scene(until: str | None = Query(default=None, pattern=HHMM)) -> dict:
        """Gates, their latest image and 3D vehicles; data after `until` is excluded."""
        try:
            return scene_builder.scene(until or clock.snapshot()["time"])
        except FileNotFoundError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except ToolError as error:
            raise HTTPException(status_code=502, detail=error.payload["detail"]) from error

    @app.get("/api/images")
    def images(until: str | None = Query(default=None, pattern=HHMM)) -> list[dict]:
        try:
            image_ids = sorted(shared.data.meta)
        except FileNotFoundError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        items = [image_context(image_id) for image_id in image_ids]
        if until is not None:
            items = [
                item for item in items if to_minutes(item["capture_time"]) <= to_minutes(until)
            ]
        return sorted(items, key=lambda item: item["capture_time"])

    @app.get("/api/images/{image_id}")
    def image(image_id: str) -> dict:
        return image_context(image_id)

    @app.get("/api/images/{image_id}/file")
    def image_file(image_id: str) -> FileResponse:
        image_context(image_id)  # 404 for unknown IDs; never a free-form path
        return FileResponse(
            settings.data_dir / "images" / f"{image_id}.jpg", media_type="image/jpeg"
        )

    @app.get("/api/images/{image_id}/detections")
    def detections(image_id: str) -> dict:
        context = image_context(image_id)
        try:
            matched = handlers.match_tracks(shared, MatchTracksInput(image_id=image_id))
        except ToolError as error:
            raise HTTPException(status_code=502, detail=error.payload["detail"]) from error
        tracks = {item["det_id"]: item["track_id"] for item in matched["matches"]}
        alternatives = shared.detection_alternatives.get(image_id, {})
        return {
            "image_id": image_id,
            "width_px": context["width_px"],
            "height_px": context["height_px"],
            "source": shared.detection_source[image_id],
            "detections": [
                {
                    "det_id": item.det_id,
                    "cls": item.vehicle_class,
                    "conf": item.confidence,
                    "alt_cls": alternatives.get(item.det_id, (None, None))[0],
                    "bbox_xywh": list(item.bbox_xywh),
                    "center_px": list(item.center_px),
                    "track_id": tracks.get(item.det_id),
                }
                for item in shared.detections[image_id]
            ],
        }

    @app.post("/api/uploads")
    async def upload_image(request: Request, name: str = Query(default="", max_length=200)) -> dict:
        """Raw image bytes in the body (no multipart); stored as JPEG, returns its ID."""
        declared = int(request.headers.get("content-length") or 0)
        if declared > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Dosya 20 MB sinirini asiyor")
        body = await request.body()
        try:
            upload = await asyncio.to_thread(save_upload, settings, body, name)
        except UploadError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {
            "image_id": upload.image_id,
            "name": upload.name,
            "width_px": upload.width_px,
            "height_px": upload.height_px,
        }

    @app.get("/api/uploads/{image_id}/file")
    def upload_file(image_id: str) -> FileResponse:
        upload = find_upload(settings, image_id)  # validates the ID; never a free path
        if upload is None:
            raise HTTPException(status_code=404, detail=f"Bilinmeyen yukleme: {image_id}")
        return FileResponse(upload.path, media_type="image/jpeg")

    @app.post("/api/chat")
    async def chat(request: ChatRequest) -> StreamingResponse:
        upload = find_upload(settings, request.image_id) if request.image_id else None
        if request.image_id is not None and upload is None:
            context = image_context(request.image_id)
            if request.sim_time is not None and to_minutes(context["capture_time"]) > to_minutes(
                request.sim_time
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"{request.image_id} {context['capture_time']} tarihli; "
                    f"simulasyon saati {request.sim_time}.",
                )
        try:
            session_id, session = session_for(request.session_id)
        except ValueError as error:  # missing API key and similar config errors
            raise HTTPException(status_code=503, detail=str(error)) from error
        question = request.message.strip()
        if upload is not None:
            question = (
                f"[Operatorun yukledigi goruntu: {upload.image_id} "
                f"({upload.width_px}x{upload.height_px} px). Cekim saati, konum ve "
                f"hareket kaydi yok.]\n{question}"
            )
        elif request.image_id:
            question = f"[Operator arayuzunde secili goruntu: {request.image_id}]\n{question}"
        if request.sim_time:
            question = (
                f"[Simulasyon saati: {request.sim_time}. Bu saatten sonra cekilen goruntuleri "
                f"ve yazilan raporlari kullanma.]\n{question}"
            )

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

        def emit(event: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (event["type"], event))

        def run() -> None:
            if not session.lock.acquire(blocking=False):
                emit({"type": "error", "detail": "Bu oturumda baska bir soru isleniyor."})
            else:
                try:
                    result = session.agent.ask(question, on_event=emit)
                    emit(
                        {
                            "type": "done",
                            "turns": result.turns,
                            "tokens_used": result.tokens_used,
                        }
                    )
                except Exception as error:  # surfaced to the operator, not swallowed
                    logger.exception("Agent run failed")
                    emit({"type": "error", "detail": f"{type(error).__name__}: {error}"})
                finally:
                    session.lock.release()
            loop.call_soon_threadsafe(queue.put_nowait, None)

        async def stream():
            yield _sse("session", {"session_id": session_id})
            worker = asyncio.create_task(asyncio.to_thread(run))
            while (item := await queue.get()) is not None:
                yield _sse(*item)
            await worker

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
