from __future__ import annotations

import json

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from baseguard.api import create_app
from baseguard.io import Settings


class ToolCallingFake(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _events(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def _brief_call(call_id: str) -> AIMessage:
    brief = {"risk_level": "BELIRSIZ", "summary": "Test ozeti."}
    return AIMessage(
        content="", tool_calls=[{"name": "submit_brief", "args": brief, "id": call_id}]
    )


def _client(tmp_path, responses) -> TestClient:
    settings = Settings(data_dir=tmp_path, agent_max_turns=3)
    model = ToolCallingFake(responses=responses)
    return TestClient(create_app(settings, model_factory=lambda _: model))


def test_chat_streams_session_brief_and_done(tmp_path):
    client = _client(tmp_path, [_brief_call("c1")])

    response = client.post("/api/chat", json={"message": "Durum nedir?"})

    assert response.status_code == 200
    events = _events(response.text)
    assert [name for name, _ in events] == ["session", "brief", "done"]
    assert events[1][1]["brief"]["summary"] == "Test ozeti."


def test_chat_reuses_session(tmp_path):
    client = _client(tmp_path, [_brief_call("c1"), _brief_call("c2")])

    first = _events(client.post("/api/chat", json={"message": "Bir"}).text)
    session_id = first[0][1]["session_id"]
    second = _events(
        client.post("/api/chat", json={"message": "Iki", "session_id": session_id}).text
    )

    assert second[0][1]["session_id"] == session_id


def test_agent_failure_is_streamed_as_error(tmp_path):
    client = _client(tmp_path, [AIMessage(content="duz metin")] * 3)

    events = _events(client.post("/api/chat", json={"message": "Durum?"}).text)

    assert events[-1][0] == "error"
    assert "AgentTurnLimitError" in events[-1][1]["detail"]


def test_missing_data_returns_503(tmp_path):
    client = _client(tmp_path, [])

    assert client.get("/api/images").status_code == 503

def _png(width: int = 64, height: int = 32) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_uploaded_image_is_stored_and_analysed_without_geo_tools(tmp_path):
    settings = Settings(
        data_dir=tmp_path, artifacts_dir=tmp_path / "artifacts", agent_max_turns=3,
        detector_weights=(tmp_path / "missing.pt",),
    )
    model = ToolCallingFake(responses=[])
    client = TestClient(create_app(settings, model_factory=lambda _: model))

    upload = client.post(
        "/api/uploads", params={"name": "../drone.png"}, content=_png(),
        headers={"Content-Type": "image/png"},
    )
    assert upload.status_code == 200
    info = upload.json()
    image_id = info["image_id"]
    assert image_id.startswith("upl_") and info["name"] == "drone.png"
    assert (info["width_px"], info["height_px"]) == (64, 32)
    assert client.get(f"/api/uploads/{image_id}/file").headers["content-type"] == "image/jpeg"
    assert client.get("/api/uploads/upl_000000000000/file").status_code == 404
    assert client.post("/api/uploads", content=b"not an image").status_code == 422

    calls = [
        {"name": "get_image_context", "args": {"image_id": image_id}, "id": "t1"},
        {"name": "pixel_to_geo", "args": {"image_id": image_id}, "id": "t2"},
        {"name": "detect_vehicles", "args": {"image_id": image_id}, "id": "t3"},
    ]
    model.responses = [AIMessage(content="", tool_calls=calls), _brief_call("b1")]
    # A sim time must not reject an upload: it has no capture time.
    response = client.post(
        "/api/chat", json={"message": "Analiz et", "image_id": image_id, "sim_time": "08:00"}
    )

    assert response.status_code == 200
    results = {data["tool"]: data for name, data in _events(response.text)
               if name == "tool_result"}
    assert results["get_image_context"]["result"]["source"] == "operator_upload"
    assert results["pixel_to_geo"]["result"]["error"] == "no_geo_metadata"
    # No weights and no tracks to stand in for detections.
    assert results["detect_vehicles"]["result"]["error"] == "detector_unavailable"
