"""Concept analysis stage for math animator."""

from __future__ import annotations

from deeptutor.agents.base_agent import BaseAgent
from deeptutor.core.context import Attachment
from deeptutor.core.trace import build_trace_metadata, new_call_id

from ..models import ConceptAnalysis
from ..utils import extract_json_object


class ConceptAnalysisAgent(BaseAgent):
    """Analyzes a math concept request to plan an animation."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        api_version: str | None = None,
        language: str = "zh",
    ) -> None:
        """Initialize the concept analysis agent.

        Args:
            api_key: LLM provider API key.
            base_url: LLM provider base URL.
            api_version: API version for Azure OpenAI (optional).
            language: Language code (``"zh"`` or ``"en"``).
        """
        super().__init__(
            module_name="math_animator",
            agent_name="concept_analysis_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )

    async def process(
        self,
        *,
        user_input: str,
        history_context: str,
        output_mode: str,
        style_hint: str,
        attachments: list[Attachment],
    ) -> ConceptAnalysis:
        """Analyze the user's animation request and produce a concept analysis.

        Args:
            user_input: The user's animation request text.
            history_context: Prior conversation context for continuity.
            output_mode: Either ``"video"`` or ``"image"``.
            style_hint: Optional style guidance from the user.
            attachments: Image attachments for reference.

        Returns:
            A :class:`ConceptAnalysis` instance.

        Raises:
            ValueError: If the analysis prompts are not configured.
        """
        system_prompt = self.get_prompt("system")
        user_template = self.get_prompt("user_template")
        if not system_prompt or not user_template:
            raise ValueError("ConceptAnalysisAgent prompts are not configured.")

        reference_count = sum(1 for item in attachments if item.type == "image")
        user_prompt = user_template.format(
            user_input=user_input.strip(),
            history_context=history_context.strip() or "(none)",
            output_mode=output_mode,
            style_hint=style_hint.strip() or "(none)",
            reference_count=reference_count,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        _chunks: list[str] = []
        async for _c in self.stream_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            messages=messages,
            attachments=attachments,
            response_format={"type": "json_object"},
            stage="concept_analysis",
            trace_meta=build_trace_metadata(
                call_id=new_call_id("math-analysis"),
                phase="concept_analysis",
                label="Concept analysis",
                call_kind="math_concept_analysis",
                trace_role="analyze",
                trace_kind="llm_output",
            ),
        ):
            _chunks.append(_c)
        response = "".join(_chunks)
        return ConceptAnalysis.model_validate(extract_json_object(response))
