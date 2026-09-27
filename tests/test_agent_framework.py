from __future__ import annotations

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage

from baseguard.agent import (
    TOOL_SPECS,
    AgentTurnLimitError,
    BaseGuardAgent,
    ToolSpec,
)
from baseguard.agent.toolkit import GetImageContextInput
from baseguard.io import Settings


def _stub(context, params):
    return {"status": "not_implemented"}


STUB_SPECS = tuple(
    ToolSpec(spec.name, spec.description, spec.input_model, _stub if spec.handler else None)
    for spec in TOOL_SPECS
)


class ToolCallingFake(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _call(name: str, args: dict, call_id: str) -> dict:
    return {"name": name, "args": args, "id": call_id}


def _brief(**overrides) -> dict:
    brief = {
        "image_id": "img_006673",
        "risk_level": "BELIRSIZ",
        "summary": "Araclar henuz veri dondurmuyor.",
    }
    return brief | overrides


def _agent(responses: list[AIMessage], specs=STUB_SPECS, **settings) -> BaseGuardAgent:
    return BaseGuardAgent(ToolCallingFake(responses=responses), Settings(**settings), specs)


def test_parallel_stub_calls_then_brief():
    agent = _agent(
        [
            AIMessage(
                content="",
                tool_calls=[
                    _call("get_image_context", {"image_id": "img_006673"}, "c1"),
                    _call("detect_vehicles", {"image_id": "img_006673"}, "c2"),
                ],
            ),
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c3")]),
        ]
    )
    events: list[dict] = []

    result = agent.ask("img_006673 riskli mi?", on_event=events.append)

    assert result.brief.risk_level == "BELIRSIZ"
    assert result.turns == 2
    assert [(r.tool, r.status) for r in result.tool_log] == [
        ("get_image_context", "not_implemented"),
        ("detect_vehicles", "not_implemented"),
    ]
    assert [e["type"] for e in events] == [
        "tool_call", "tool_call", "tool_result", "tool_result", "brief",
    ]
    replied = {m.tool_call_id for m in agent.messages if isinstance(m, ToolMessage)}
    assert replied == {"c1", "c2", "c3"}


def test_invalid_arguments_and_unknown_tool_are_reported_to_model():
    agent = _agent(
        [
            AIMessage(
                content="",
                tool_calls=[
                    _call("search_reports", {"time": "14:10"}, "c1"),
                    _call("launch_missiles", {}, "c2"),
                ],
            ),
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c3")]),
        ]
    )

    result = agent.ask("Raporlar ne diyor?")

    assert [r.result["error"] for r in result.tool_log] == [
        "invalid_arguments",
        "unknown_tool",
    ]


def test_brief_citing_unreturned_id_is_rejected_then_corrected():
    concern = {"det_id": "D1", "risk_level": "YUKSEK", "reason": "x", "evidence_ids": []}
    agent = _agent(
        [
            AIMessage(
                content="",
                tool_calls=[
                    _call("submit_brief", _brief(vehicles_of_concern=[concern]), "c1")
                ],
            ),
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c2")]),
        ]
    )

    result = agent.ask("img_006673 riskli mi?")

    rejection = next(m for m in agent.messages if getattr(m, "tool_call_id", "") == "c1")
    assert "D1" in rejection.content and "rejected" in rejection.content
    assert result.brief.vehicles_of_concern == []


def test_ids_from_successful_tools_are_grounded():
    def fake_context(context, params):
        return {"status": "ok", "vehicles": [{"det_id": "D1", "track_id": "T0095"}]}

    specs = (
        ToolSpec("get_image_context", "test", GetImageContextInput, fake_context),
        *[spec for spec in STUB_SPECS if spec.name != "get_image_context"],
    )
    concern = {
        "det_id": "D1",
        "track_id": "T0095",
        "risk_level": "ORTA",
        "reason": "yaklasiyor",
        "evidence_ids": ["D1", "T0095"],
    }
    agent = _agent(
        [
            AIMessage(
                content="",
                tool_calls=[_call("get_image_context", {"image_id": "img_1"}, "c1")],
            ),
            AIMessage(
                content="",
                tool_calls=[
                    _call(
                        "submit_brief",
                        _brief(risk_level="ORTA", vehicles_of_concern=[concern]),
                        "c2",
                    )
                ],
            ),
        ],
        specs=specs,
    )

    assert agent.ask("img_1?").brief.vehicles_of_concern[0].track_id == "T0095"


def test_plain_text_answer_is_nudged_and_turn_limit_raises():
    agent = _agent(
        [AIMessage(content="Bence riskli."), AIMessage(content="Hala metin.")],
        agent_max_turns=2,
    )

    with pytest.raises(AgentTurnLimitError):
        agent.ask("img_006673 riskli mi?")


def test_follow_up_question_keeps_history():
    agent = _agent(
        [
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c1")]),
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c2")]),
        ]
    )
    agent.ask("img_006673 riskli mi?")
    agent.ask("T0095'in rotasi ne?")

    humans = [m.content for m in agent.messages if m.type == "human"]
    assert humans == ["img_006673 riskli mi?", "T0095'in rotasi ne?"]


def test_report_listed_twice_is_rejected():
    def fake_reports(context, params):
        return {"status": "ok", "by_location": [{"report_id": "R001"}]}

    specs = tuple(
        ToolSpec(spec.name, spec.description, spec.input_model, fake_reports)
        if spec.name == "search_reports"
        else spec
        for spec in STUB_SPECS
    )
    judgement = {"report_id": "R001", "time": "12:00", "verdict": "uyumlu", "reason": "x"}
    twice = _brief(used_reports=[judgement], rejected_reports=[judgement])
    agent = _agent(
        [
            AIMessage(
                content="",
                tool_calls=[
                    _call("search_reports", {"time": "12:00", "zone": "Kuzey Yolu"}, "c1")
                ],
            ),
            AIMessage(content="", tool_calls=[_call("submit_brief", twice, "c2")]),
            AIMessage(
                content="",
                tool_calls=[_call("submit_brief", _brief(used_reports=[judgement]), "c3")],
            ),
        ],
        specs=specs,
    )

    result = agent.ask("img_006673 riskli mi?")

    assert result.turns == 3 and len(result.brief.used_reports) == 1


def _spent(message: AIMessage, tokens: int) -> AIMessage:
    message.usage_metadata = {
        "input_tokens": tokens, "output_tokens": 0, "total_tokens": tokens
    }
    return message


def test_token_budget_is_per_question_and_does_not_lock_the_session():
    from baseguard.agent import AgentBudgetExceededError

    agent = _agent(
        [
            _spent(AIMessage(content="dusunuyorum"), 900),
            _spent(AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c1")]), 50),
        ],
        agent_token_budget=500,
    )

    with pytest.raises(AgentBudgetExceededError):
        agent.ask("Ilk soru")
    result = agent.ask("Ikinci soru")

    assert result.tokens_used == 50
    assert agent.tokens_used == 950


def test_previous_tool_results_are_compacted_but_ids_stay_citable():
    def big_result(context, params):
        return {"status": "ok", "vehicles": [{"det_id": "D1", "track_id": "T0095"}],
                "padding": "x" * 2_000}

    specs = tuple(
        ToolSpec(spec.name, spec.description, spec.input_model, big_result)
        if spec.name == "get_image_context"
        else spec
        for spec in STUB_SPECS
    )
    concern = {"det_id": "D1", "track_id": "T0095", "risk_level": "ORTA",
               "reason": "x", "evidence_ids": ["D1"]}
    agent = _agent(
        [
            AIMessage(content="", tool_calls=[_call("get_image_context", {"image_id": "i"}, "c1")]),
            AIMessage(content="", tool_calls=[_call("submit_brief", _brief(), "c2")]),
            AIMessage(content="", tool_calls=[
                _call("submit_brief", _brief(risk_level="ORTA", vehicles_of_concern=[concern]), "c3")
            ]),
        ],
        specs=specs,
    )
    agent.ask("Ilk soru")
    result = agent.ask("Takip sorusu")

    old = next(m for m in agent.messages if getattr(m, "tool_call_id", "") == "c1")
    assert len(old.content) < 400 and "T0095" in old.content
    assert result.brief.vehicles_of_concern[0].track_id == "T0095"
