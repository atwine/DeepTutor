from typing import Any, Dict

from pydantic import BaseModel, field_validator


class LLMConfig(BaseModel):
    """Configuration for the language model backend."""

    model: str
    provider: str = "openai"


class PathsConfig(BaseModel):
    """Filesystem paths used by DeepTutor for user data and logs."""

    user_data_dir: str
    knowledge_bases_dir: str
    user_log_dir: str


class AppConfig(BaseModel):
    """Top-level application configuration combining LLM and path settings."""

    llm: LLMConfig
    paths: PathsConfig

    @field_validator("llm", mode="before")
    @classmethod
    def ensure_llm(cls, v: Any) -> Dict[str, Any]:
        """Validates the ``llm`` section before model construction.

        Args:
            v: The raw value supplied for the ``llm`` field.

        Returns:
            The validated ``llm`` mapping.

        Raises:
            ValueError: If ``v`` is not a mapping or is missing the
                ``model`` key.
        """
        if not isinstance(v, dict):
            raise ValueError("llm section must be a mapping")
        if "model" not in v:
            raise ValueError("llm.model is required")
        return v


CURRENT_SCHEMA_VERSION = 1


def migrate_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    No-op migration for now; placeholder for future versioned changes.
    """
    return cfg
