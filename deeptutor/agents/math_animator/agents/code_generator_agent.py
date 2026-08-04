"""Code generation and repair stages for math animator."""

from __future__ import annotations

import json

from deeptutor.agents.base_agent import BaseAgent
from deeptutor.core.trace import build_trace_metadata, new_call_id

from ..models import ConceptAnalysis, GeneratedCode, SceneDesign
from ..utils import build_repair_error_message, extract_json_object


class CodeGeneratorAgent(BaseAgent):
    """Generates and repairs Manim source code for math animations."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        api_version: str | None = None,
        language: str = "zh",
    ) -> None:
        """Initialize the code generator agent.

        Args:
            api_key: LLM provider API key.
            base_url: LLM provider base URL.
            api_version: API version for Azure OpenAI (optional).
            language: Language code (``"zh"`` or ``"en"``).
        """
        super().__init__(
            module_name="math_animator",
            agent_name="code_generator_agent",
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
        duration_target_seconds: float | None = None,
    ) -> GeneratedCode:
        """BaseAgent-compatible entrypoint for the default generation path."""
        return await self.generate(
            user_input=user_input,
            output_mode=output_mode,
            analysis=analysis,
            design=design,
            duration_target_seconds=duration_target_seconds,
        )

    async def generate(
        self,
        *,
        user_input: str,
        output_mode: str,
        analysis: ConceptAnalysis,
        design: SceneDesign,
        duration_target_seconds: float | None = None,
    ) -> GeneratedCode:
        """Generate Manim source code from the analysis and design.

        Args:
            user_input: The user's animation request text.
            output_mode: Either ``"video"`` or ``"image"``.
            analysis: The concept analysis result.
            design: The scene design result.
            duration_target_seconds: Optional target animation duration in seconds.

        Returns:
            A :class:`GeneratedCode` instance with the Manim source.

        Raises:
            ValueError: If the generation prompts are not configured.
        """
        system_prompt = self.get_prompt("generate_system")
        user_template = self.get_prompt("generate_user_template")
        if not system_prompt or not user_template:
            raise ValueError("CodeGeneratorAgent generation prompts are not configured.")

        user_prompt = user_template.format(
            user_input=user_input.strip(),
            output_mode=output_mode,
            duration_requirement=(
                f"用户明确目标时长约 {duration_target_seconds:.1f} 秒，生成代码必须围绕该时长做节奏预算。"
                if duration_target_seconds is not None
                else "用户未给出明确秒数时长，可按标准教学节奏生成。"
            ),
            analysis_json=json.dumps(analysis.model_dump(), ensure_ascii=False, indent=2),
            design_json=json.dumps(design.model_dump(), ensure_ascii=False, indent=2),
        )
        _chunks: list[str] = []
        async for _c in self.stream_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            response_format={"type": "json_object"},
            stage="code_generation",
            trace_meta=build_trace_metadata(
                call_id=new_call_id("math-codegen"),
                phase="code_generation",
                label="Code generation",
                call_kind="math_code_generation",
                trace_role="generate",
                trace_kind="llm_output",
            ),
        ):
            _chunks.append(_c)
        response = "".join(_chunks)
        return GeneratedCode.model_validate(extract_json_object(response))

    async def repair(
        self,
        *,
        user_input: str,
        output_mode: str,
        current_code: str,
        error_message: str,
        attempt: int,
        duration_target_seconds: float | None = None,
    ) -> GeneratedCode:
        """Generate repaired Manim code based on a render error.

        Args:
            user_input: The user's animation request text.
            output_mode: Either ``"video"`` or ``"image"``.
            current_code: The Manim code that failed to render.
            error_message: The error message from the failed render.
            attempt: The retry attempt number (1-based).
            duration_target_seconds: Optional target animation duration in seconds.

        Returns:
            A :class:`GeneratedCode` instance with the repaired Manim source.

        Raises:
            ValueError: If the retry prompts are not configured.
        """
        system_prompt = self.get_prompt("retry_system")
        user_template = self.get_prompt("retry_user_template")
        if not system_prompt or not user_template:
            raise ValueError("CodeGeneratorAgent retry prompts are not configured.")

        user_prompt = user_template.format(
            user_input=user_input.strip(),
            output_mode=output_mode,
            attempt=attempt,
            duration_requirement=(
                f"目标时长约 {duration_target_seconds:.1f} 秒，修复后仍需保持接近该时长。"
                if duration_target_seconds is not None
                else "无明确目标时长。"
            ),
            error_message=build_repair_error_message(error_message),
            current_code=current_code,
        )
        _chunks: list[str] = []
        async for _c in self.stream_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            response_format={"type": "json_object"},
            stage="code_retry",
            trace_meta=build_trace_metadata(
                call_id=new_call_id("math-retry"),
                phase="code_retry",
                label=f"Code retry #{attempt}",
                call_kind="math_code_retry",
                trace_role="repair",
                trace_kind="llm_output",
                attempt=attempt,
            ),
        ):
            _chunks.append(_c)
        response = "".join(_chunks)
        return GeneratedCode.model_validate(extract_json_object(response))
