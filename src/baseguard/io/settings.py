"""Environment-backed application settings."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    data_dir: Path = Path("data")
    artifacts_dir: Path = Path("artifacts")
    # Stage 1 "ensemble esit": both models at every size, fused with WBF.
    detector_weights: tuple[Path, ...] = (Path("weights/m_1280.pt"), Path("weights/m_1408.pt"))
    detector_sizes: tuple[int, ...] = (1408, 1536, 1664)
    detector_device: str = ""  # empty: CUDA, then Apple MPS, then CPU
    # Without weights, detect_vehicles derives clearly labelled detections from the
    # track end points at capture time so the rest of the pipeline stays demoable.
    detector_fallback_to_tracks: bool = True
    glm_base_url: str = ""
    glm_api_key: str = Field(default="", repr=False)
    glm_model: str = "glm-5.3-flash"
    llm_provider: Literal["groq", "glm"] = "glm"
    groq_api_key: str = Field(default="", repr=False)
    groq_model: str = "openai/gpt-oss-120b"
    groq_vision_model: str = "qwen/qwen3.8-27b"
    llm_reasoning_effort: Literal["low", "high", "max"] = "low"
    agent_max_turns: int = Field(default=10, ge=1, le=20)
    agent_max_parallel_tools: int = Field(default=4, ge=1, le=8)
    agent_token_budget: int = Field(default=200_000, gt=0)  # per question


def get_settings() -> Settings:
    return Settings()
