"""Tool-calling agent loop: think -> tool_call -> observe, ending with submit_brief.

One `BaseGuardAgent` is one operator chat session. It keeps the message history and
the tool context, so follow-up questions ("T0095'in rotasi ne?") reuse earlier
tool results.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from baseguard.domain import RiskBrief
from baseguard.io import Settings

from .handlers import ToolError
from .prompt import AGENT_SYSTEM_PROMPT
from .toolkit import SUBMIT_BRIEF, TOOL_SPECS, ToolContext, ToolSpec, langchain_tools
from .validator import collect_evidence_ids, validate_risk_brief

logger = logging.getLogger(__name__)

NUDGE_SUBMIT = (
    "Yanitini duz metin olarak degil, submit_brief araciyla teslim et. "
    "Eksik veri varsa once ilgili araci cagir."
)

COMPACT_ABOVE = 400  # characters
COMPACT_NOTE = "Onceki soruda dondu; ayrinti gerekirse araci ayni argumanlarla tekrar cagir."

EventSink = Callable[[dict[str, Any]], None]


class AgentTurnLimitError(RuntimeError):
    """The model did not submit a valid brief within the turn limit."""


class AgentBudgetExceededError(RuntimeError):
    """One question spent its token budget; the loop stops instead of running on."""


@dataclass
class ToolCallRecord:
    turn: int
    tool: str
    args: dict[str, Any]
    status: str
    duration_ms: float
    result: dict[str, Any]


@dataclass
class AgentResult:
    question: str
    brief: RiskBrief
    turns: int
    tokens_used: int
    tool_log: list[ToolCallRecord] = field(default_factory=list)


class BaseGuardAgent:
    def __init__(
        self,
        model: Any,
        settings: Settings,
        specs: tuple[ToolSpec, ...] = TOOL_SPECS,
        system_prompt: str = AGENT_SYSTEM_PROMPT,
    ) -> None:
        tools = langchain_tools(specs)
        self._specs = {spec.name: spec for spec in specs}
        self._tool_model = model.bind_tools(tools)
        # Last turn forces a brief so the loop always ends with the output schema.
        self._final_model = model.bind_tools(tools, tool_choice=SUBMIT_BRIEF)
        self._settings = settings
        self.context = ToolContext(settings=settings)
        self.messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
        self.known_ids: set[str] = set()
        self.computed_level: str | None = None
        self.tokens_used = 0  # whole session, for reporting only

    def ask(self, question: str, on_event: EventSink | None = None) -> AgentResult:
        question = question.strip()
        if not question:
            raise ValueError("A non-empty question is required")
        emit = on_event or (lambda _event: None)
        self._compact_history()
        self.messages.append(HumanMessage(content=question))
        tool_log: list[ToolCallRecord] = []
        max_turns = self._settings.agent_max_turns
        question_tokens = 0

        for turn in range(1, max_turns + 1):
            # Per question: guards against a runaway loop without locking the session.
            if question_tokens >= self._settings.agent_token_budget:
                raise AgentBudgetExceededError(
                    f"Token budget for this question spent: {question_tokens} tokens"
                )
            model = self._final_model if turn == max_turns else self._tool_model
            response: AIMessage = model.invoke(self.messages)
            self.messages.append(response)
            if response.usage_metadata:
                spent = response.usage_metadata.get("total_tokens", 0)
                question_tokens += spent
                self.tokens_used += spent
            if response.content:
                emit({"type": "assistant_text", "turn": turn, "text": response.content})

            if not response.tool_calls:
                self.messages.append(HumanMessage(content=NUDGE_SUBMIT))
                continue

            work_calls = [c for c in response.tool_calls if c["name"] != SUBMIT_BRIEF]
            brief_calls = [c for c in response.tool_calls if c["name"] == SUBMIT_BRIEF]
            for call in work_calls:
                emit({"type": "tool_call", "turn": turn, "tool": call["name"],
                      "args": call["args"]})
            records = self._run_tools(work_calls, turn)
            for call, record in zip(work_calls, records, strict=True):
                tool_log.append(record)
                self._observe(record)
                emit({"type": "tool_result", "turn": turn, "tool": record.tool,
                      "status": record.status, "result": record.result})
                self._reply(call, record.result)

            brief = self._accept_brief(brief_calls, emit, turn)
            if brief is not None:
                emit({"type": "brief", "turn": turn, "brief": brief.model_dump()})
                return AgentResult(
                    question=question,
                    brief=brief,
                    turns=turn,
                    tokens_used=question_tokens,
                    tool_log=tool_log,
                )

        raise AgentTurnLimitError(f"No valid brief after {max_turns} turns")

    def _compact_history(self) -> None:
        """Shrink tool results from earlier questions before asking a new one.

        Every model call resends the whole history, so large results (tracks,
        reports) would make each follow-up costlier. Tools are deterministic and
        cheap to call again; the IDs they returned stay known and citable.
        """
        for index, message in enumerate(self.messages):
            if not isinstance(message, ToolMessage) or len(message.content) <= COMPACT_ABOVE:
                continue
            try:
                ids = sorted(collect_evidence_ids(json.loads(message.content)))
            except ValueError:
                ids = []
            self.messages[index] = ToolMessage(
                content=json.dumps(
                    {"status": "compacted", "note": COMPACT_NOTE, "ids": ids},
                    ensure_ascii=False,
                ),
                tool_call_id=message.tool_call_id,
                name=message.name,
            )

    def _run_tools(self, calls: list[dict], turn: int) -> list[ToolCallRecord]:
        if len(calls) <= 1:
            return [self._execute(call, turn) for call in calls]
        workers = min(len(calls), self._settings.agent_max_parallel_tools)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(lambda call: self._execute(call, turn), calls))

    def _execute(self, call: dict, turn: int) -> ToolCallRecord:
        started = perf_counter()
        spec = self._specs.get(call["name"])
        if spec is None or spec.handler is None:
            result: dict[str, Any] = {"status": "error", "error": "unknown_tool"}
        else:
            try:
                params = spec.input_model.model_validate(call["args"])
            except ValueError as error:
                params = None
                result = {"status": "error", "error": "invalid_arguments",
                          "detail": str(error)}
            if params is not None:
                result = self._invoke(spec, params)
        return ToolCallRecord(
            turn=turn,
            tool=call["name"],
            args=call["args"],
            status=result.get("status", "ok"),
            duration_ms=round((perf_counter() - started) * 1000, 1),
            result=result,
        )

    def _invoke(self, spec: ToolSpec, params: Any) -> dict[str, Any]:
        try:
            return spec.handler(self.context, params)
        except ToolError as error:
            return error.payload
        except Exception as error:  # a failing tool must not end the session
            logger.exception("Tool %s failed", spec.name)
            return {"status": "error", "error": "tool_failed",
                    "detail": f"{type(error).__name__}: {error}"}

    def _observe(self, record: ToolCallRecord) -> None:
        """Remember grounded IDs and the rule-based level from successful tools."""
        if record.status != "ok":
            return
        self.known_ids |= collect_evidence_ids(record.result)
        if record.tool == "compute_risk" and "image_risk" in record.result:
            self.computed_level = record.result["image_risk"]

    def _accept_brief(
        self, calls: list[dict], emit: EventSink, turn: int
    ) -> RiskBrief | None:
        """Validate submitted briefs; every call gets a reply to keep history valid."""
        accepted: RiskBrief | None = None
        for call in calls:
            if accepted is not None:
                self._reply(call, {"status": "ignored", "reason": "duplicate_brief"})
                continue
            try:
                brief = RiskBrief.model_validate(call["args"])
                validate_risk_brief(brief, self.known_ids, self.computed_level)
            except ValueError as error:
                emit({"type": "brief_rejected", "turn": turn, "error": str(error)})
                self._reply(call, {"status": "rejected", "error": str(error)})
                continue
            self._reply(call, {"status": "accepted"})
            accepted = brief
        return accepted

    def _reply(self, call: dict, payload: dict[str, Any]) -> None:
        self.messages.append(
            ToolMessage(
                content=json.dumps(payload, ensure_ascii=False, default=str),
                tool_call_id=call["id"],
                name=call["name"],
            )
        )