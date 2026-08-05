from typing import Callable


class ConfigAccessor:
    """Provides typed access to a lazily-loaded configuration dictionary."""

    def __init__(self, loader: Callable[[], dict]):
        """Initializes the accessor with a configuration loader callable.

        Args:
            loader: A zero-argument callable that returns the current
                configuration as a dictionary.
        """
        self._loader = loader

    def llm_model(self) -> str:
        """Returns the configured LLM model name.

        Returns:
            The model name, defaulting to ``"Pro/Flash"`` when unset.
        """
        cfg = self._loader()
        return str(cfg.get("llm", {}).get("model", "Pro/Flash"))

    def llm_provider(self) -> str:
        """Returns the configured LLM provider identifier.

        Returns:
            The provider name, defaulting to ``"openai"`` when unset.
        """
        cfg = self._loader()
        return str(cfg.get("llm", {}).get("provider", "openai"))

    def user_data_dir(self) -> str:
        """Returns the configured user data directory path.

        Returns:
            The user data directory, defaulting to ``"./data/user"`` when
            unset.
        """
        cfg = self._loader()
        return str(cfg.get("paths", {}).get("user_data_dir", "./data/user"))
