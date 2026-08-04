"""Summary stage for math animator."""

from __future__ import annotations

import json

from deeptutor.agents.base_agent import BaseAgent
from deeptutor.core.trace import build_trace_metadata, new_call_id

from ..models import ConceptAnalysis, RenderResult, SceneDesign, SummaryPayload
from ..utils import extract_json_object


class SummaryAgent(BaseAgent):
    """Produces a human-readable summary of the math animation output."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        api_version: str | None = None,
        language: str = "zh",
    ) -> None:
        """Initialize the summary agent.

        Args:
            api_key: LLM provider API key.
            base_url: LLM provider base URL.
            api_version: API version for Azure OpenAI (optional).
            language: Language code (``"zh"`` or ``"en"``).
        """
        super().__init__(
            module_name="math_animator",
            agent_name="summary_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )

    async def process(
        self,
        *,
        user_input: str,
        output_mode: str,
        analysis: ConceptAnalysis,
        design: SceneDesign,
        render_result: RenderResult,
    ) -> SummaryPayload:
        """Generate a summary of the animation result.

        Args:
            user_input: The user's animation request text.
            output_mode: Either ``"video"`` or ``"image"``.
            analysis: The concept analysis result.
            design: The scene design result.
            render_result: The render result with artifacts.

        Returns:
            A :class:`SummaryPayload` instance.

        Raises:
            ValueError: If the summary prompts are not configured.
        """
        system_prompt = self.get_prompt("system")
        user_template = self.get_prompt("user_template")
        if not system_prompt or not user_template:
            raise ValueError("SummaryAgent prompts are not configured.")

        user_prompt = user_template.format(
            user_input=user_input.strip(),
            output_mode=output_mode,
            analysis_json=json.dumps(analysis.model_dump(), ensure_ascii=False, indent=2),
            design_json=json.dumps(design.model_dump(), ensure_ascii=False, indent=2),
            render_json=json.dumps(render_result.model_dump(), ensure_ascii=False, indent=2),
        )
        _chunks: list[str] = []
        async for _c in self.stream_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            response_format={"type": "json_object"},
            stage="summary",
            trace_meta=build_trace_metadata(
                call_id=new_call_id("math-summary"),
                phase="summary",
                label="Summarize result",
                call_kind="math_summary",
                trace_role="summarize",
                trace_kind="llm_output",
            ),
        ):
            _chunks.append(_c)
        response = "".join(_chunks)
        return SummaryPayload.model_validate(extract_json_object(response))
