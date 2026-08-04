"""Jupyter Notebook (.ipynb) parser for RAG ingestion.

An ``.ipynb`` file is a JSON document with a ``cells`` array where each cell
is either ``markdown``, ``code``, or ``raw``. This module extracts the
human-readable content of every cell into structured chunks so notebooks
become searchable / citable material in the knowledge base.

Each chunk carries:
  * ``text``        — the cell content (markdown text, source code, or raw text)
  * ``cell_type``   — ``"markdown"`` | ``"code"`` | ``"raw"``
  * ``cell_index``  — 0-based position of the cell in the notebook (for citation)
  * ``language``    — kernel language for code cells (``"python"`` by default)
  * ``source_file`` — the notebook filename (for citation)

Text outputs of code cells are included (joined under the code); image /
base64 outputs are skipped. Malformed JSON raises a clear ``NotebookParseError``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Sequence

logger = logging.getLogger(__name__)


class NotebookParseError(Exception):
    """Raised when a notebook file cannot be parsed (malformed JSON, etc.)."""


@dataclass
class NotebookChunk:
    """A single extracted unit of notebook content."""

    text: str
    cell_type: str  # "markdown" | "code" | "raw"
    cell_index: int
    language: str  # "" for non-code cells
    source_file: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _join_source(source: Any) -> str:
    """Join a cell ``source`` field which may be a list or a string."""
    if source is None:
        return ""
    if isinstance(source, str):
        return source
    if isinstance(source, (list, tuple)):
        return "".join(str(part) for part in source)
    return str(source)


def _extract_text_output(output: dict[str, Any]) -> str:
    """Extract printable text from a single code-cell output dict.

    Handles ``stream`` outputs (stdout/stderr) and ``execute_result`` /
    ``display_data`` outputs that carry a ``text/plain`` mime type. Image /
    base64 outputs are intentionally skipped.
    """
    output_type = output.get("output_type")

    if output_type == "stream":
        text = _join_source(output.get("text"))
        return text

    if output_type in ("execute_result", "display_data"):
        data = output.get("data") or {}
        if isinstance(data, dict) and "text/plain" in data:
            return _join_source(data["text/plain"])

    return ""


def _extract_outputs(outputs: Any) -> str:
    """Collect all text outputs from a code cell's ``outputs`` list."""
    if not outputs or not isinstance(outputs, (list, tuple)):
        return ""
    parts: list[str] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue
        text = _extract_text_output(output)
        if text.strip():
            parts.append(text)
    return "\n".join(parts)


def _get_language(nb_metadata: dict[str, Any]) -> str:
    """Resolve the kernel language from notebook metadata.

    Falls back to ``"python"`` when the kernelspec is missing or has no
    ``language`` field — the overwhelming default for Jupyter notebooks.
    """
    kernelspec = nb_metadata.get("kernelspec") or {}
    if isinstance(kernelspec, dict):
        lang = kernelspec.get("language")
        if isinstance(lang, str) and lang.strip():
            return lang.strip()
    language_info = nb_metadata.get("language_info") or {}
    if isinstance(language_info, dict):
        lang = language_info.get("name")
        if isinstance(lang, str) and lang.strip():
            return lang.strip()
    return "python"


def _parse_notebook_dict(
    nb: dict[str, Any], source_file: str
) -> list[NotebookChunk]:
    """Parse an already-decoded notebook dict into chunks."""
    metadata = nb.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    language = _get_language(metadata)

    cells = nb.get("cells")
    if not isinstance(cells, list):
        return []

    chunks: list[NotebookChunk] = []
    for index, cell in enumerate(cells):
        if not isinstance(cell, dict):
            continue

        cell_type = cell.get("cell_type") or "raw"
        source_text = _join_source(cell.get("source"))

        if cell_type == "code":
            text_parts: list[str] = [source_text]
            outputs_text = _extract_outputs(cell.get("outputs"))
            if outputs_text:
                text_parts.append(f"\n# Output:\n{outputs_text}")
            text = "\n".join(part for part in text_parts if part)
            chunks.append(
                NotebookChunk(
                    text=text,
                    cell_type="code",
                    cell_index=index,
                    language=language,
                    source_file=source_file,
                )
            )
        elif cell_type == "markdown":
            if source_text.strip():
                chunks.append(
                    NotebookChunk(
                        text=source_text,
                        cell_type="markdown",
                        cell_index=index,
                        language="",
                        source_file=source_file,
                    )
                )
        else:
            # raw cells (and any non-standard type) → treat as plain text
            if source_text.strip():
                chunks.append(
                    NotebookChunk(
                        text=source_text,
                        cell_type="raw",
                        cell_index=index,
                        language="",
                        source_file=source_file,
                    )
                )

    return chunks


def parse_notebook_bytes(data: bytes, source_file: str = "") -> list[NotebookChunk]:
    """Parse notebook content from raw bytes.

    Raises ``NotebookParseError`` on malformed JSON.
    """
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")

    try:
        nb = json.loads(text)
    except json.JSONDecodeError as exc:
        raise NotebookParseError(
            f"{source_file or '<notebook>'} is not valid JSON: {exc.msg} "
            f"(line {exc.lineno}, column {exc.colno})"
        ) from exc

    if not isinstance(nb, dict):
        raise NotebookParseError(
            f"{source_file or '<notebook>'}: expected a JSON object at the top level"
        )

    return _parse_notebook_dict(nb, source_file)


def parse_notebook_file(file_path: str | Path) -> list[NotebookChunk]:
    """Parse an ``.ipynb`` file from disk into a list of chunks.

    Raises ``NotebookParseError`` on malformed JSON or read errors.
    """
    path = Path(file_path)
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise NotebookParseError(f"Failed to read {path.name}: {exc}") from exc
    return parse_notebook_bytes(data, source_file=path.name)


def chunks_to_text(chunks: Sequence[NotebookChunk]) -> str:
    """Flatten parsed chunks into a single readable text block.

    Each cell is rendered with a header that records the cell type, index,
    and language (for code cells) so the downstream ``SentenceSplitter`` can
    chunk the notebook while preserving citation context inside the text.
    """
    parts: list[str] = []
    for chunk in chunks:
        if chunk.cell_type == "code":
            header = f"```{chunk.language}" if chunk.language else "```"
            parts.append(
                f"--- Cell {chunk.cell_index} (code, {chunk.language or 'unknown'}) ---\n"
                f"{header}\n{chunk.text}\n```"
            )
        elif chunk.cell_type == "markdown":
            parts.append(
                f"--- Cell {chunk.cell_index} (markdown) ---\n{chunk.text}"
            )
        else:
            parts.append(
                f"--- Cell {chunk.cell_index} (raw) ---\n{chunk.text}"
            )
    return "\n\n".join(parts)


def notebook_to_text(file_path: str | Path) -> str:
    """Convenience: parse a notebook file and return its flattened text.

    Returns an empty string when the notebook has no extractable content.
    Raises ``NotebookParseError`` on malformed JSON.
    """
    chunks = parse_notebook_file(file_path)
    return chunks_to_text(chunks)
