"""
Capability Registry
===================

Central registry for all capabilities (built-in and plugin).
"""

from __future__ import annotations

import importlib
import logging
from typing import Any

from deeptutor.core.capability_protocol import BaseCapability
from deeptutor.i18n.metadata_i18n import capability_description_i18n
from deeptutor.runtime.bootstrap.builtin_capabilities import BUILTIN_CAPABILITY_CLASSES

logger = logging.getLogger(__name__)


def _import_capability_class(path: str) -> type[BaseCapability]:
    module_path, class_name = path.rsplit(":", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def _load_plugin_hooks():
    try:
        module = importlib.import_module("deeptutor.plugins.loader")
    except Exception:
        logger.debug("Plugin loader unavailable; skipping plugin discovery.", exc_info=True)
        return None, None
    return (
        getattr(module, "discover_plugins", None),
        getattr(module, "load_plugin_capability", None),
    )


class CapabilityRegistry:
    """Registry of available capabilities."""

    def __init__(self) -> None:
        """Initialise an empty capability registry."""
        self._capabilities: dict[str, BaseCapability] = {}

    def register(self, capability: BaseCapability) -> None:
        """Register a capability instance under its name.

        Args:
            capability: The capability to register.
        """
        self._capabilities[capability.name] = capability
        logger.debug("Registered capability: %s", capability.name)

    def load_builtins(self) -> None:
        """Instantiate and register all built-in capabilities."""
        for name, class_path in BUILTIN_CAPABILITY_CLASSES.items():
            if name in self._capabilities:
                continue
            try:
                cls = _import_capability_class(class_path)
                self.register(cls())
            except Exception:
                logger.warning("Failed to load capability %s", name, exc_info=True)

    def load_plugins(self) -> None:
        """Discover and register plugin capabilities via the plugin loader."""
        discover_plugins, load_plugin_capability = _load_plugin_hooks()
        if discover_plugins is None or load_plugin_capability is None:
            return

        for manifest in discover_plugins():
            if manifest.name in self._capabilities:
                continue
            if manifest.entry.endswith("tool.py"):
                continue
            try:
                capability = load_plugin_capability(manifest)
                if capability is not None:
                    self.register(capability)
            except Exception:
                logger.warning(
                    "Failed to load plugin capability %s",
                    manifest.name,
                    exc_info=True,
                )

    def get(self, name: str) -> BaseCapability | None:
        """Return the capability registered under *name*, or ``None`` if absent."""
        return self._capabilities.get(name)

    def list_capabilities(self) -> list[str]:
        """Return the names of all registered capabilities."""
        return list(self._capabilities.keys())

    def get_manifests(self) -> list[dict[str, Any]]:
        """Return manifest dictionaries for every registered capability."""
        return [
            {
                "name": c.manifest.name,
                "description": c.manifest.description,
                "description_i18n": capability_description_i18n(
                    c.manifest.name,
                    c.manifest.description,
                ),
                "stages": c.manifest.stages,
                "tools_used": c.manifest.tools_used,
                "cli_aliases": c.manifest.cli_aliases,
                "request_schema": c.manifest.request_schema,
                "config_defaults": c.manifest.config_defaults,
            }
            for c in self._capabilities.values()
        ]


_default_registry: CapabilityRegistry | None = None


def get_capability_registry() -> CapabilityRegistry:
    """Return the global capability registry, loading builtins and plugins on first call."""
    global _default_registry
    if _default_registry is None:
        _default_registry = CapabilityRegistry()
        _default_registry.load_builtins()
        _default_registry.load_plugins()
    return _default_registry
