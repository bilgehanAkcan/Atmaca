"""The sole provider boundary for GLM and Groq chat models."""

from __future__ import annotations

from baseguard.io import Settings


def create_chat_model(settings: Settings):
    """Build the selected LangChain model without leaking credentials to callers."""
    if settings.llm_provider == "groq":
        if not settings.groq_api_key:
            raise ValueError(
                "GROQ_API_KEY must be configured in .env when LLM_PROVIDER=groq"
            )
        from langchain_groq import ChatGroq

        return ChatGroq(
            model=settings.groq_model,
            api_key=settings.groq_api_key,
            temperature=0.1,
            max_tokens=2_000,
            timeout=45,
            max_retries=2,
        )
    if not settings.glm_api_key or not settings.glm_base_url:
        raise ValueError(
            "GLM_BASE_URL and GLM_API_KEY must be configured in .env when LLM_PROVIDER=glm"
        )
    from langchain_openai import ChatOpenAI

    # No token limit: with reasoning_effort set, LangChain sends max_tokens as
    # max_completion_tokens, which the GLM gateway rejects (400). The task guide
    # allows omitting it; reasoning also spends from that limit, so a low one
    # would return empty content anyway. The agent's turn and token budgets cap cost.
    return ChatOpenAI(
        model=settings.glm_model,
        base_url=settings.glm_base_url,
        api_key=settings.glm_api_key,
        temperature=0.1,
        reasoning_effort=settings.llm_reasoning_effort,
        timeout=90,
        max_retries=2,
    )


def create_vision_model(settings: Settings):
    """Image-capable chat model for inspect_crop. GLM reads images itself."""
    if settings.llm_provider == "groq":
        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY must be configured in .env")
        from langchain_groq import ChatGroq

        return ChatGroq(
            model=settings.groq_vision_model,
            api_key=settings.groq_api_key,
            temperature=0.1,
            max_tokens=500,
            timeout=45,
            max_retries=2,
        )
    return create_chat_model(settings)
