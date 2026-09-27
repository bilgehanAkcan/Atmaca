"""Interactive operator chat against the configured LLM (uses the API budget).

    python scripts/agent_chat.py
    > img_006673 riskli mi?
    > T0095'in rotasi ne?
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from baseguard.agent import BaseGuardAgent, create_chat_model
from baseguard.io import get_settings


def print_event(event: dict) -> None:
    kind = event["type"]
    if kind == "tool_call":
        print(f"  [{event['turn']}] -> {event['tool']}({json.dumps(event['args'], ensure_ascii=False)})")
    elif kind == "tool_result":
        print(f"  [{event['turn']}] <- {event['tool']}: {event['status']}")
    elif kind == "brief_rejected":
        print(f"  [{event['turn']}] brief rejected: {event['error']}")


def main() -> None:
    settings = get_settings()
    agent = BaseGuardAgent(create_chat_model(settings), settings)
    while True:
        try:
            question = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not question:
            continue
        result = agent.ask(question, on_event=print_event)
        print(json.dumps(result.brief.model_dump(), ensure_ascii=False, indent=2))
        print(f"  turns={result.turns} tokens_used={result.tokens_used}")


if __name__ == "__main__":
    main()
