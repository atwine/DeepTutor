"""Agentic chat capability."""

from __future__ import annotations

from deeptutor.agents.chat.agentic_pipeline import CHAT_OPTIONAL_TOOLS, AgenticChatPipeline
from deeptutor.core.capability_protocol import BaseCapability, CapabilityManifest
from deeptutor.core.context import UnifiedContext
from deeptutor.core.stream_bus import StreamBus
from deeptutor.runtime.request_contracts import get_capability_request_schema


class ChatCapability(BaseCapability):
    """Capability wrapper for the agentic chat pipeline."""

    manifest = CapabilityManifest(
        name="chat",
        description=(
            "Agentic chat: an exploring agent loop with tools, followed by "
            "a respond stage that streams the answer."
        ),
        stages=["exploring", "responding"],
        tools_used=CHAT_OPTIONAL_TOOLS,
        cli_aliases=["chat"],
        request_schema=get_capability_request_schema("chat"),
    )

    async def run(self, context: UnifiedContext, stream: StreamBus) -> None:
        """Execute the chat capability for one turn.

        Args:
            context: The unified context for the current turn.
            stream: The stream bus for emitting events to the frontend.
        """
        pipeline = AgenticChatPipeline(language=context.language)
        await pipeline.run(context, stream)
