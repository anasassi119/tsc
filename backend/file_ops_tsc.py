"""Track file tool calls and compute unified diffs for TSC WebSocket streaming."""

from __future__ import annotations

import difflib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from deepagents.backends.protocol import BackendProtocol

logger = logging.getLogger(__name__)


def compute_unified_diff(
    before: str,
    after: str,
    display_path: str,
    *,
    max_lines: int | None = 100,
    context_lines: int = 3,
) -> str | None:
    """Compute a unified diff between before and after content."""
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    diff_lines = list(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=f"{display_path} (before)",
            tofile=f"{display_path} (after)",
            lineterm="",
            n=context_lines,
        )
    )
    if not diff_lines:
        return None
    if max_lines is not None and len(diff_lines) > max_lines:
        truncated = diff_lines[: max_lines - 1]
        truncated.append("...")
        return "\n".join(truncated)
    return "\n".join(diff_lines)


def _format_display_path(path_str: str) -> str:
    if not path_str:
        return "(unknown)"
    try:
        path = Path(path_str)
        if path.is_absolute():
            return path.name or str(path)
        return str(path)
    except (OSError, ValueError):
        return str(path_str)


def _count_lines(text: str) -> int:
    if not text:
        return 0
    return len(text.splitlines())


@dataclass
class FileOperationRecord:
    """Track a single filesystem tool call."""

    tool_name: str
    display_path: str
    tool_call_id: str | None
    args: dict[str, Any] = field(default_factory=dict)
    before_content: str | None = None
    after_content: str | None = None
    diff: str | None = None


class TSCFileOpTracker:
    """Track file operations during one agent turn for diff previews."""

    def __init__(self, backend: BackendProtocol | None) -> None:
        self._backend = backend
        self._active: dict[str | None, FileOperationRecord] = {}

    def start_operation(
        self, tool_name: str, args: dict[str, Any], tool_call_id: str | None
    ) -> None:
        """Begin tracking read/write/edit operations."""
        if tool_name not in {"read_file", "write_file", "edit_file"}:
            return
        path_str = str(args.get("file_path") or args.get("path") or "")
        display_path = _format_display_path(path_str)
        record = FileOperationRecord(
            tool_name=tool_name,
            display_path=display_path,
            tool_call_id=tool_call_id,
            args=args,
        )
        if tool_name in {"write_file", "edit_file"} and self._backend and path_str:
            try:
                responses = self._backend.download_files([path_str])
                if (
                    responses
                    and responses[0].content is not None
                    and responses[0].error is None
                ):
                    record.before_content = responses[0].content.decode("utf-8")
                else:
                    record.before_content = ""
            except (OSError, UnicodeDecodeError, AttributeError) as exc:
                logger.debug("before_content read failed: %s", exc)
                record.before_content = ""
        self._active[tool_call_id] = record

    def complete_with_message(self, tool_message: Any) -> FileOperationRecord | None:  # noqa: ANN401
        """Finalize tracking when ToolMessage arrives."""
        tool_call_id = getattr(tool_message, "tool_call_id", None)
        record = self._active.get(tool_call_id)
        if record is None:
            return None

        content = tool_message.content
        if isinstance(content, list):
            content_text = "\n".join(
                item if isinstance(item, str) else str(item) for item in content
            )
        else:
            content_text = str(content) if content is not None else ""

        if getattr(tool_message, "status", "success") != "success":
            self._active.pop(tool_call_id, None)
            return None

        if record.tool_name == "read_file":
            self._active.pop(tool_call_id, None)
            return None

        if self._backend:
            file_path = record.args.get("file_path") or record.args.get("path")
            if file_path:
                try:
                    responses = self._backend.download_files([str(file_path)])
                    if (
                        responses
                        and responses[0].content is not None
                        and responses[0].error is None
                    ):
                        record.after_content = responses[0].content.decode("utf-8")
                except (OSError, UnicodeDecodeError, AttributeError) as exc:
                    logger.debug("after_content read failed: %s", exc)

        if record.after_content is None:
            self._active.pop(tool_call_id, None)
            return None

        record.diff = compute_unified_diff(
            record.before_content or "",
            record.after_content,
            record.display_path,
            max_lines=100,
        )
        self._active.pop(tool_call_id, None)
        return record
