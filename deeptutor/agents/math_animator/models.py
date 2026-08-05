"""Shared data models for the math animator pipeline."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ConceptAnalysis(BaseModel):
    """Structured analysis of a math concept for animation planning."""

    model_config = ConfigDict(extra="ignore")

    learning_goal: str = ""
    math_focus: list[str] = Field(default_factory=list)
    visual_targets: list[str] = Field(default_factory=list)
    narrative_steps: list[str] = Field(default_factory=list)
    reference_usage: str = ""
    output_intent: str = ""


class SceneDesign(BaseModel):
    """Design specification for a Manim scene (outline, style, constraints)."""

    model_config = ConfigDict(extra="ignore")

    title: str = ""
    scene_outline: list[str] = Field(default_factory=list)
    visual_style: str = ""
    animation_notes: list[str] = Field(default_factory=list)
    image_plan: list[str] = Field(default_factory=list)
    code_constraints: list[str] = Field(default_factory=list)


class GeneratedCode(BaseModel):
    """Manim source code produced by the code generation or repair stage."""

    model_config = ConfigDict(extra="ignore")

    code: str = ""
    rationale: str = ""


class SummaryPayload(BaseModel):
    """Human-readable summary of the math animation output."""

    model_config = ConfigDict(extra="ignore")

    summary_text: str = ""
    user_request: str = ""
    generated_output: str = ""
    key_points: list[str] = Field(default_factory=list)


class RenderedArtifact(BaseModel):
    """A single rendered artifact (video file or image file) with metadata."""

    model_config = ConfigDict(extra="ignore")

    type: str
    url: str
    filename: str
    content_type: str = ""
    label: str = ""


class RetryAttempt(BaseModel):
    """Record of a single render-retry attempt with its error message."""

    model_config = ConfigDict(extra="ignore")

    attempt: int
    error: str


class VisualReviewResult(BaseModel):
    """Outcome of a visual quality review of rendered frames."""

    model_config = ConfigDict(extra="ignore")

    passed: bool = True
    summary: str = ""
    issues: list[str] = Field(default_factory=list)
    suggested_fix: str = ""
    reviewed_frames: int = 0


class RenderResult(BaseModel):
    """Final result of the Manim render stage (artifacts, paths, retry history)."""

    model_config = ConfigDict(extra="ignore")

    output_mode: str
    artifacts: list[RenderedArtifact] = Field(default_factory=list)
    public_code_path: str = ""
    source_code_path: str = ""
    quality: str = ""
    retry_attempts: int = 0
    retry_history: list[RetryAttempt] = Field(default_factory=list)
    visual_review: VisualReviewResult | None = None


__all__ = [
    "ConceptAnalysis",
    "GeneratedCode",
    "RenderResult",
    "RenderedArtifact",
    "RetryAttempt",
    "SceneDesign",
    "SummaryPayload",
    "VisualReviewResult",
]
