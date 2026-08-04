"""Orchestrates the three-stage visualization generation flow."""

from __future__ import annotations

from typing import Any, Callable

from deeptutor.core.context import Attachment

from .agents import AnalysisAgent, CodeGeneratorAgent, ReviewAgent
from .models import ReviewResult, VisualizationAnalysis


class VisualizePipeline:
    """Orchestrates the three-stage visualization generation flow."""

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str | None,
        api_version: str | None,
        language: str = "zh",
        trace_callback: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        """Initialize the pipeline with LLM credentials and sub-agents.

        Args:
            api_key: LLM provider API key.
            base_url: LLM provider base URL.
            api_version: API version for Azure OpenAI (optional).
            language: Language code (``"zh"`` or ``"en"``).
            trace_callback: Optional callback for structured trace events.
        """
        self.analysis_agent = AnalysisAgent(
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )
        self.code_agent = CodeGeneratorAgent(
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )
        self.review_agent = ReviewAgent(
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )
        self.set_trace_callback(trace_callback)

    def set_trace_callback(self, callback: Callable[[dict[str, Any]], Any] | None) -> None:
        """Propagate a trace callback to all sub-agents.

        Args:
            callback: The trace callback to register, or ``None`` to clear.
        """
        for agent in (self.analysis_agent, self.code_agent, self.review_agent):
            agent.set_trace_callback(callback)

    async def run_analysis(
        self,
        *,
        user_input: str,
        history_context: str,
        render_mode: str = "auto",
        attachments: list[Attachment] | None = None,
    ) -> VisualizationAnalysis:
        """Run the analysis stage to determine the render type and brief.

        Args:
            user_input: The user's visualization request text.
            history_context: Prior conversation context for continuity.
            render_mode: Requested render mode (``"auto"``, ``"svg"``, etc.).
            attachments: Optional image attachments for reference.

        Returns:
            A :class:`VisualizationAnalysis` instance.
        """
        return await self.analysis_agent.process(
            user_input=user_input,
            history_context=history_context,
            render_mode=render_mode,
            attachments=attachments,
        )

    async def run_code_generation(
        self,
        *,
        user_input: str,
        history_context: str,
        analysis: VisualizationAnalysis,
    ) -> str:
        """Run the code generation stage to produce visualization code.

        Args:
            user_input: The user's visualization request text.
            history_context: Prior conversation context for continuity.
            analysis: The analysis result with the chosen render type.

        Returns:
            The generated visualization code string.
        """
        return await self.code_agent.process(
            user_input=user_input,
            history_context=history_context,
            analysis=analysis,
        )

    async def run_repair(
        self,
        *,
        user_input: str,
        analysis: VisualizationAnalysis,
        code: str,
        error: str,
    ) -> ReviewResult:
        """Run a targeted repair pass on code that failed local validation.

        Args:
            user_input: The user's visualization request text.
            analysis: The analysis result with the chosen render type.
            code: The visualization code that failed validation.
            error: The validation error message to fix.

        Returns:
            A :class:`ReviewResult` with the repaired code.
        """
        return await self.review_agent.process(
            user_input=user_input,
            analysis=analysis,
            code=code,
            error=error,
        )


__all__ = ["VisualizePipeline"]
