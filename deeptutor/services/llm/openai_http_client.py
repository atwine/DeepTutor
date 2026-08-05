"""HTTP client helpers for OpenAI-compatible SDK providers."""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

import httpx

from deeptutor.services.config import load_system_settings
from deeptutor.services.llm.exceptions import LLMConfigError

logger = logging.getLogger(__name__)

_warning_lock = threading.Lock()
_warning_logged = False

# The OpenAI SDK's own default timeout is 600s (10 minutes) per attempt, with
# no override anywhere in this codebase — confirmed the root cause of chat
# turns hanging for many minutes against a degraded/half-alive vLLM or
# OpenRouter connection before DeepTutor's own retry-or-fail wrapper
# (provider_core/base.py, up to 9 attempts) even gets a chance to run.
# `connect` fails fast (10s) when the endpoint is truly unreachable; `read`
# stays generous (120s) since a real 70B-model response can legitimately take
# 40-90s under load — this must not misfire on a slow-but-working call.
DEFAULT_LLM_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)


def disable_ssl_verify_enabled() -> bool:
    """Return whether outbound TLS verification should be disabled."""
    if not load_system_settings()["disable_ssl_verify"]:
        return False
    if os.getenv("ENVIRONMENT", "").strip().lower() in {"prod", "production"}:
        raise LLMConfigError("DISABLE_SSL_VERIFY is not allowed in production")
    global _warning_logged
    with _warning_lock:
        if not _warning_logged:
            logger.warning(
                "SSL verification is disabled via DISABLE_SSL_VERIFY. This is unsafe "
                "and must not be used in production environments."
            )
            _warning_logged = True
    return True


def build_openai_http_client(**kwargs: Any) -> httpx.AsyncClient:
    """Build the httpx client every ``AsyncOpenAI`` instance in this codebase
    uses — always sets ``DEFAULT_LLM_TIMEOUT`` (see its docstring for why),
    and additionally disables TLS verification when DISABLE_SSL_VERIFY is on.
    """
    kwargs.setdefault("timeout", DEFAULT_LLM_TIMEOUT)
    if disable_ssl_verify_enabled():
        kwargs["verify"] = False  # nosec B501
    return httpx.AsyncClient(**kwargs)


def openai_client_kwargs(**httpx_kwargs: Any) -> dict[str, httpx.AsyncClient]:
    """Return kwargs to pass into ``AsyncOpenAI`` for custom HTTP behavior."""
    return {"http_client": build_openai_http_client(**httpx_kwargs)}


__all__ = [
    "build_openai_http_client",
    "disable_ssl_verify_enabled",
    "openai_client_kwargs",
]
