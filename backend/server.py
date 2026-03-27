"""FastAPI WebSocket server for TSC agent communication."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver

from agents.orchestrator import create_orchestrator_agent
from file_ops_tsc import TSCFileOpTracker
from tools.workspace import create_readonly_backend, create_workspace_backend

# Persistent checkpointer: set in lifespan, used by all sessions.
_checkpointer: Any = None
_checkpointer_ctx: Any = None


def _get_checkpoint_db_path() -> Path:
    """Path to SQLite DB for LangGraph checkpoint persistence."""
    raw = os.environ.get("TSC_CHECKPOINT_DB")
    if raw:
        return Path(raw)
    root = Path(__file__).resolve().parent
    root.mkdir(parents=True, exist_ok=True)
    return root / ".checkpoints" / "state.sqlite"


def _patch_aiosqlite() -> None:
    """Patch aiosqlite.Connection with `is_alive()` if missing (langgraph-checkpoint)."""
    import aiosqlite as _aiosqlite

    if hasattr(_aiosqlite.Connection, "is_alive"):
        return

    def _is_alive(self: _aiosqlite.Connection) -> bool:
        return bool(getattr(self, "_running", False) and getattr(self, "_connection", None) is not None)

    _aiosqlite.Connection.is_alive = _is_alive  # type: ignore[attr-defined]


_sessions: dict[str, "AgentSession"] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler. Opens persistent SQLite checkpointer for agent state."""
    global _checkpointer, _checkpointer_ctx  # noqa: PLW0603
    print("TSC Backend starting...")
    _patch_aiosqlite()
    db_path = _get_checkpoint_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    _checkpointer_ctx = AsyncSqliteSaver.from_conn_string(str(db_path))
    _checkpointer = await _checkpointer_ctx.__aenter__()
    print(f"[TSC] Persistent checkpointer: {db_path}")
    yield
    for session in _sessions.values():
        session.cleanup_sandbox()
    await _checkpointer_ctx.__aexit__(None, None, None)
    _checkpointer = None
    _checkpointer_ctx = None
    print("TSC Backend shutting down...")


app = FastAPI(title="TSC Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAIN_AGENT_LABEL = "Orchestrator"


def _agent_label_from_ns(ns_key: tuple[str, ...]) -> str:
    """Derive a display label from LangGraph namespace (last segment is usually subagent name)."""
    if not ns_key:
        return MAIN_AGENT_LABEL
    return str(ns_key[-1])


def _resolved_project_root(workspace_dir: str, project_id: str | None) -> str:
    """Per-project subdirectory ``proj-<8 hex chars>`` under the user workspace folder."""
    ws = Path(workspace_dir).resolve()
    if not project_id:
        slug = uuid.uuid4().hex[:8]
    else:
        hexpart = "".join(c for c in project_id if c in "0123456789abcdefABCDEF")[:8]
        slug = hexpart or uuid.uuid4().hex[:8]
    sub = ws / f"proj-{slug}"
    sub.mkdir(parents=True, exist_ok=True)
    return str(sub.resolve())


def _tool_message_to_text(message: ToolMessage) -> str:
    """Human-readable tool result string."""
    content = message.content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content) if content is not None else ""


def _normalize_todos_for_emit(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        content = t.get("content") or t.get("text") or str(t)
        status = t.get("status", "pending")
        if isinstance(status, str) and status not in (
            "pending",
            "in_progress",
            "completed",
            "cancelled",
        ):
            status = "pending"
        out.append({
            "id": t.get("id") or str(uuid.uuid4()),
            "content": content,
            "status": status,
        })
    return out


def _normalize_initial_todos(raw: Any) -> list[dict[str, Any]]:
    """Map client todos into LangGraph todo channel shape."""
    items = _normalize_todos_for_emit(raw)
    # LangChain write_todos often uses activeForm; optional pass-through
    for item in items:
        if "activeForm" not in item:
            item["activeForm"] = item.get("content", "")
    return items


_HANDOFF_HEADER_RE = re.compile(r"^#{2,3}\s+Handoff\s+Report\s*$", re.MULTILINE)
_SECTION_RE = re.compile(r"^###\s+(.+?)\s*$", re.MULTILINE)


def _parse_handoff_report(text: str) -> dict[str, Any] | None:
    """Extract structured data from a Handoff Report markdown block.

    Returns None if no ``## Handoff Report`` header is found.
    """
    match = _HANDOFF_HEADER_RE.search(text)
    if not match:
        return None
    body = text[match.end() :]

    sections: dict[str, str] = {}
    positions = list(_SECTION_RE.finditer(body))
    for i, m in enumerate(positions):
        name = m.group(1).strip()
        start = m.end()
        end = positions[i + 1].start() if i + 1 < len(positions) else len(body)
        sections[name.lower()] = body[start:end].strip()

    def _bullet_lines(raw: str) -> list[str]:
        return [ln.lstrip("- ").strip() for ln in raw.splitlines() if ln.strip().startswith("-")]

    files = _bullet_lines(sections.get("files modified", ""))
    commands = _bullet_lines(sections.get("commands run", ""))
    decisions = _bullet_lines(sections.get("decisions made", ""))
    issues = _bullet_lines(sections.get("open issues", ""))
    summary = sections.get("summary", "").strip()

    verification: dict[str, str] = {}
    for ln in sections.get("verification", "").splitlines():
        ln = ln.strip().lstrip("- ").strip()
        if ":" in ln:
            key, val = ln.split(":", 1)
            verification[key.strip().lower()] = val.strip()

    return {
        "filesModified": files,
        "commandsRun": commands,
        "decisionsMade": decisions,
        "openIssues": issues,
        "verification": verification,
        "summary": summary,
    }


async def _stream_agent_turn(
    agent: Any,
    input_state: dict[str, Any],
    config: dict[str, Any],
    *,
    send_json: Any,
    doc_backend: Any,
    dev_backend: Any,
) -> None:
    """Consume agent.astream (messages + updates, v2 parts) and emit TSC WebSocket events."""
    trackers: dict[tuple[str, ...], TSCFileOpTracker] = {}

    def get_tracker(ns_key: tuple[str, ...]) -> TSCFileOpTracker:
        if ns_key not in trackers:
            backend = doc_backend if not ns_key else dev_backend
            trackers[ns_key] = TSCFileOpTracker(backend)
        return trackers[ns_key]

    displayed_tool_ids: set[str] = set()
    tool_call_buffers: dict[str | int, dict[str, Any]] = {}
    last_ns: tuple[str, ...] | None = None

    stream_kwargs: dict[str, Any] = {
        "stream_mode": ["messages", "updates"],
        "subgraphs": True,
        "config": config,
        "version": "v2",
    }
    try:
        stream_iter = agent.astream(input_state, **stream_kwargs, durability="exit")
    except TypeError:
        stream_iter = agent.astream(input_state, **stream_kwargs)

    async def emit_messages_for_ns(ns_key: tuple[str, ...], message: Any) -> None:
        agent_label = _agent_label_from_ns(ns_key)
        scope = "main" if not ns_key else "subagent"
        buffer_prefix = "main" if not ns_key else ":".join(ns_key)
        tracker = get_tracker(ns_key)
        await _process_stream_message(
            message,
            tracker,
            displayed_tool_ids,
            tool_call_buffers,
            send_json,
            agent_label=agent_label,
            scope=scope,
            buffer_prefix=buffer_prefix,
        )

    async for part in stream_iter:
        # LangGraph v1 fallback: (namespace, mode, data) tuples
        if isinstance(part, tuple) and len(part) == 3:
            namespace, current_stream_mode, data = part
            ns_key = tuple(namespace) if namespace else ()
            if ns_key != last_ns:
                if last_ns is not None and len(last_ns) > 0 and len(ns_key) == 0:
                    await send_json({
                        "event": "on_subagent_end",
                        "data": {"agent": _agent_label_from_ns(last_ns)},
                    })
                if len(ns_key) > 0 and (last_ns is None or len(last_ns) == 0):
                    await send_json({
                        "event": "on_subagent_start",
                        "data": {
                            "namespace": str(ns_key),
                            "agent": _agent_label_from_ns(ns_key),
                        },
                    })
                last_ns = ns_key
            if current_stream_mode == "updates":
                if not isinstance(data, dict):
                    continue
                if "__interrupt__" in data:
                    pass
                for node_out in data.values():
                    if isinstance(node_out, dict) and "todos" in node_out:
                        todos = _normalize_todos_for_emit(node_out["todos"])
                        if todos:
                            await send_json({"event": "on_todos_update", "data": {"todos": todos}})
                continue
            if current_stream_mode != "messages":
                continue
            if not isinstance(data, tuple) or len(data) != 2:
                continue
            message, _metadata = data
            await emit_messages_for_ns(ns_key, message)
            continue

        if not isinstance(part, dict):
            continue
        ptype = part.get("type")
        ns_key = part.get("ns")
        if not isinstance(ns_key, tuple):
            ns_key = ()

        if ns_key != last_ns:
            if last_ns is not None and len(last_ns) > 0 and len(ns_key) == 0:
                await send_json({
                    "event": "on_subagent_end",
                    "data": {"agent": _agent_label_from_ns(last_ns)},
                })
            if len(ns_key) > 0 and (last_ns is None or len(last_ns) == 0):
                await send_json({
                    "event": "on_subagent_start",
                    "data": {
                        "namespace": str(ns_key),
                        "agent": _agent_label_from_ns(ns_key),
                    },
                })
            last_ns = ns_key

        if ptype == "updates":
            data = part.get("data")
            if not isinstance(data, dict):
                continue
            if "__interrupt__" in data:
                pass
            for node_out in data.values():
                if isinstance(node_out, dict) and "todos" in node_out:
                    todos = _normalize_todos_for_emit(node_out["todos"])
                    if todos:
                        await send_json({"event": "on_todos_update", "data": {"todos": todos}})
            continue

        if ptype != "messages":
            continue

        data = part.get("data")
        if not isinstance(data, tuple) or len(data) != 2:
            continue
        message, _metadata = data

        await emit_messages_for_ns(ns_key, message)

    if last_ns is not None and len(last_ns) > 0:
        await send_json({
            "event": "on_subagent_end",
            "data": {"agent": _agent_label_from_ns(last_ns)},
        })


async def _process_stream_message(
    message: Any,
    tracker: TSCFileOpTracker,
    displayed_tool_ids: set[str],
    tool_call_buffers: dict[str | int, dict[str, Any]],
    send_json: Any,
    *,
    agent_label: str,
    scope: str,
    buffer_prefix: str,
) -> None:
    """Handle one streamed message tuple (message, metadata) for main or subgraph agents."""
    if isinstance(message, ToolMessage):
        tool_name = getattr(message, "name", "") or ""
        tool_status = getattr(message, "status", "success")
        output_str = _tool_message_to_text(message)
        tool_id = getattr(message, "tool_call_id", None)
        status_ok = tool_status == "success" and not output_str.lower().startswith("error")

        diff_str: str | None = None
        display_path: str | None = None
        record = tracker.complete_with_message(message)
        if record and record.diff:
            diff_str = record.diff
            display_path = record.display_path

        await send_json({
            "event": "on_tool_result",
            "data": {
                "tool_result": {
                    "id": tool_id or "",
                    "name": tool_name,
                    "result": output_str,
                    "status": "success" if status_ok else "error",
                    "diff": diff_str,
                    "diff_path": display_path,
                    "agent": agent_label,
                    "scope": scope,
                },
            },
        })

        if tool_name == "task":
            report = _parse_handoff_report(output_str)
            if report is not None:
                await send_json({
                    "event": "on_handoff_report",
                    "data": {"agent": agent_label, **report},
                })

        if tool_name == "write_todos":
            raw = message.content
            todos_src: Any = raw
            if isinstance(raw, list):
                todos_src = raw
            todos = _normalize_todos_for_emit(todos_src)
            if todos:
                await send_json({"event": "on_todos_update", "data": {"todos": todos}})
        return

    if not hasattr(message, "content_blocks"):
        return

    blocks = getattr(message, "content_blocks", []) or []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text", "")
            if text:
                await send_json({
                    "event": "on_text_chunk",
                    "data": {"chunk": text, "agent": agent_label, "scope": scope},
                })
        elif block_type in {"tool_call_chunk", "tool_call"}:
            chunk_name = block.get("name")
            chunk_args = block.get("args")
            chunk_id = block.get("id")
            chunk_index = block.get("index")
            buffer_key: str | int
            if chunk_index is not None:
                buffer_key = chunk_index
            elif chunk_id is not None:
                buffer_key = chunk_id
            else:
                buffer_key = f"unknown-{len(tool_call_buffers)}"

            storage_key = f"{buffer_prefix}|{buffer_key}"
            buffer = tool_call_buffers.setdefault(
                storage_key,
                {"name": None, "id": None, "args": None, "args_parts": []},
            )
            if chunk_name:
                buffer["name"] = chunk_name
            if chunk_id:
                buffer["id"] = chunk_id
            if isinstance(chunk_args, dict):
                buffer["args"] = chunk_args
                buffer["args_parts"] = []
            elif isinstance(chunk_args, str):
                if chunk_args:
                    parts: list[str] = buffer.setdefault("args_parts", [])
                    if not parts or chunk_args != parts[-1]:
                        parts.append(chunk_args)
                    buffer["args"] = "".join(parts)
            elif chunk_args is not None:
                buffer["args"] = chunk_args

            buffer_name = buffer.get("name")
            buffer_id = buffer.get("id")
            if buffer_name is None:
                continue

            parsed_args = buffer.get("args")
            if isinstance(parsed_args, str):
                if not parsed_args:
                    continue
                try:
                    parsed_args = json.loads(parsed_args)
                except json.JSONDecodeError:
                    continue
            elif parsed_args is None:
                continue
            if not isinstance(parsed_args, dict):
                parsed_args = {"value": parsed_args}

            display_key = f"{buffer_prefix}|{buffer_id}"
            if buffer_id is not None and display_key not in displayed_tool_ids:
                displayed_tool_ids.add(display_key)
                tracker.start_operation(buffer_name, parsed_args, str(buffer_id))
                await send_json({
                    "event": "on_tool_call",
                    "data": {
                        "tool_call": {
                            "id": str(buffer_id),
                            "name": buffer_name,
                            "args": parsed_args,
                            "agent": agent_label,
                            "scope": scope,
                        },
                    },
                })
            tool_call_buffers.pop(storage_key, None)


_TRANSIENT_ERROR_KEYWORDS: frozenset[str] = frozenset({
    "overloaded",
    "rate_limit",
    "rate limit",
    "too many requests",
    "service_unavailable",
    "service unavailable",
    "server_error",
    "internal server error",
    "timeout",
    "connection",
    "temporarily unavailable",
})


def _is_transient_api_error(exc: BaseException) -> bool:
    """Check if an exception is a transient API error worth retrying.

    Covers Anthropic overloaded/rate-limit errors, OpenAI rate limits,
    and generic HTTP 429/500/502/503/529 errors from any provider.
    """
    exc_str = str(exc).lower()
    if any(kw in exc_str for kw in _TRANSIENT_ERROR_KEYWORDS):
        return True
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if isinstance(status, int) and status in {429, 500, 502, 503, 529}:
        return True
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc:
        return _is_transient_api_error(cause)
    return False


PROTOCOL_VERSION = 2


class AgentSession:
    """One orchestrator session; one LangGraph thread per session_id."""

    def __init__(self, config: dict[str, Any], *, checkpointer: Any = None):
        self.session_id = config.get("session_id") or str(uuid.uuid4())
        self.config = config
        self.websocket: WebSocket | None = None
        self.agent: Any = None
        self._doc_backend: Any = None
        self._dev_backend: Any = None
        self.checkpointer = checkpointer if checkpointer is not None else MemorySaver()
        self.thread_id = self.session_id
        self._current_run_task: asyncio.Task[None] | None = None
        self._project_root: str | None = None
        self._running = False
        self.protocol_version: int = int(config.get("protocol", 1))
        self.initial_todos: list[dict[str, Any]] = _normalize_initial_todos(
            config.get("initial_todos") or []
        )

    def attach_websocket(self, ws: WebSocket) -> None:
        self.websocket = ws

    async def initialize(self) -> bool:
        workspace_dir = self.config.get("workspace_dir", "")
        print(f"[TSC] Initializing session {self.session_id}: workspace={workspace_dir}")

        if not workspace_dir:
            await self._send_error("No workspace directory specified. Please configure it in Settings.")
            return False
        if not os.path.isdir(workspace_dir):
            await self._send_error(f"Workspace directory does not exist: {workspace_dir}")
            return False

        raw_pid = self.config.get("project_id")
        project_id = raw_pid if isinstance(raw_pid, str) and raw_pid.strip() else None
        try:
            project_root = _resolved_project_root(workspace_dir, project_id)
        except OSError as exc:
            await self._send_error(f"Could not create project directory: {exc}")
            return False
        self._project_root = project_root
        print(f"[TSC] Project root (scoped): {project_root}")

        # Write project context (from questionnaire) to workspace if provided
        project_context = self.config.get("project_context")
        if project_context and isinstance(project_context, dict):
            try:
                tsc_dir = Path(project_root) / ".tsc"
                tsc_dir.mkdir(parents=True, exist_ok=True)
                context_path = tsc_dir / "project-context.json"
                context_path.write_text(json.dumps(project_context, indent=2))
                print(f"[TSC] Project context written: {context_path}")
            except OSError as exc:
                print(f"[TSC] Warning: could not write project context: {exc}")

        provider = self.config.get("provider", "anthropic")
        model = self.config.get("model", "claude-sonnet-4-6")
        model_string = f"{provider}:{model}"

        api_key = self.config.get("api_key")
        if not api_key:
            await self._send_error(f"No API key provided for {provider}.")
            return False

        env_var = {
            "anthropic": "ANTHROPIC_API_KEY",
            "openai": "OPENAI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }.get(provider)
        if env_var:
            os.environ[env_var] = api_key

        doc_backend = create_readonly_backend(project_root)
        self._doc_backend = doc_backend
        try:
            dev_backend = create_workspace_backend(project_root)
        except RuntimeError as exc:
            await self._send_error(str(exc))
            return False
        self._dev_backend = dev_backend

        self.agent = create_orchestrator_agent(
            doc_backend,
            dev_backend,
            model_string,
            checkpointer=self.checkpointer,
        )

        print(f"[TSC] Session {self.session_id} initialized (thread={self.thread_id})")
        return True

    def interrupt_sandbox(self) -> None:
        """Kill in-flight shell subprocess (docker exec or local shell)."""
        if self._dev_backend and hasattr(self._dev_backend, "interrupt_execute"):
            try:
                self._dev_backend.interrupt_execute()
            except Exception as exc:
                print(f"[TSC] interrupt_sandbox error for session {self.session_id}: {exc}")

    def cleanup_sandbox(self) -> None:
        if self._dev_backend and hasattr(self._dev_backend, "cleanup"):
            try:
                self._dev_backend.cleanup()
            except Exception as exc:
                print(f"[TSC] Sandbox cleanup error for session {self.session_id}: {exc}")

    async def _send_json(self, payload: dict[str, Any]) -> None:
        if self.websocket:
            try:
                await self.websocket.send_json(payload)
            except Exception as exc:
                print(f"[TSC] send_json error: {exc}")

    async def _send_error(self, message: str) -> None:
        await self._send_json({"event": "on_error", "data": {"error": message}})

    async def handle_message(self, message: str) -> None:
        if not self.agent:
            await self._send_error("Agent not initialized")
            return

        if self._running:
            await self._send_error(
                "A turn is already in progress. Wait for it to finish or stop it first."
            )
            return
        self._running = True

        try:
            await self._send_json({"event": "on_agent_start", "data": {"agent": MAIN_AGENT_LABEL}})
            await self._send_json({"event": "on_active_agent", "data": {"agent": MAIN_AGENT_LABEL}})

            config: dict[str, Any] = {
                "configurable": {"thread_id": self.thread_id},
                "recursion_limit": 500,
            }
            input_state: dict[str, Any] = {"messages": [HumanMessage(content=message)]}
            if self.initial_todos:
                input_state["todos"] = self.initial_todos

            max_retries = 3
            for attempt in range(max_retries):
                try:
                    await _stream_agent_turn(
                        self.agent,
                        input_state,
                        config,
                        send_json=self._send_json,
                        doc_backend=self._doc_backend,
                        dev_backend=self._dev_backend,
                    )
                    break
                except Exception as exc:
                    if _is_transient_api_error(exc) and attempt < max_retries - 1:
                        wait = 2 ** (attempt + 1)
                        logger.warning(
                            "Transient API error (attempt %d/%d), retrying in %ds: %s",
                            attempt + 1, max_retries, wait, exc,
                        )
                        await self._send_json({
                            "event": "on_text_chunk",
                            "data": {
                                "chunk": f"\n\n*API temporarily unavailable — retrying in {wait}s...*\n\n",
                                "agent": MAIN_AGENT_LABEL,
                                "scope": "main",
                            },
                        })
                        await asyncio.sleep(wait)
                        continue
                    traceback.print_exc()
                    await self._send_error(str(exc))
                    break

            await self._send_json({"event": "on_turn_end", "data": {}})
        finally:
            self._running = False


async def _run_handle_message(session: "AgentSession", message: str) -> None:
    try:
        await session.handle_message(message)
    except asyncio.CancelledError:
        session._running = False
        session.interrupt_sandbox()
        await session._send_json({"event": "on_turn_end", "data": {}})
        raise


@app.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket):
    await websocket.accept()
    session: AgentSession | None = None

    try:
        config_data = await websocket.receive_json()
        session_id = config_data.get("session_id")

        if session_id and session_id in _sessions:
            session = _sessions[session_id]
            session.attach_websocket(websocket)
            if "initial_todos" in config_data:
                session.initial_todos = _normalize_initial_todos(config_data.get("initial_todos"))
            if "protocol" in config_data:
                session.protocol_version = int(config_data["protocol"])
            print(f"[TSC] Resumed session {session_id}")
            await websocket.send_json({
                "event": "on_session_resumed",
                "data": {"session_id": session_id, "protocol": session.protocol_version},
            })
        else:
            session = AgentSession(config_data, checkpointer=_checkpointer)
            session.attach_websocket(websocket)
            if not await session.initialize():
                return
            _sessions[session.session_id] = session
            await websocket.send_json({
                "event": "on_session_created",
                "data": {"session_id": session.session_id, "protocol": session.protocol_version},
            })

        while True:
            data = await websocket.receive_json()
            if data.get("type") == "stop":
                if session._current_run_task and not session._current_run_task.done():
                    session._current_run_task.cancel()
                    try:
                        await session._current_run_task
                    except asyncio.CancelledError:
                        pass
                    session._current_run_task = None
                await session._send_json({"event": "on_turn_end", "data": {}})
            elif "message" in data:
                if session._current_run_task and not session._current_run_task.done():
                    session._current_run_task.cancel()
                    try:
                        await session._current_run_task
                    except asyncio.CancelledError:
                        pass
                session._current_run_task = asyncio.create_task(
                    _run_handle_message(session, data["message"])
                )
                while session._current_run_task and not session._current_run_task.done():
                    recv_task = asyncio.create_task(websocket.receive_json())
                    done, pending = await asyncio.wait(
                        [session._current_run_task, recv_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if recv_task in done:
                        run_task = session._current_run_task
                        for t in pending:
                            t.cancel()
                            if t is run_task:
                                try:
                                    await t
                                except asyncio.CancelledError:
                                    pass
                        try:
                            next_data = recv_task.result()
                        except Exception:
                            break
                        if next_data.get("type") == "stop":
                            if session._current_run_task and not session._current_run_task.done():
                                session._current_run_task.cancel()
                                try:
                                    await session._current_run_task
                                except asyncio.CancelledError:
                                    pass
                            session._current_run_task = None
                            await session._send_json({"event": "on_turn_end", "data": {}})
                            break
                        if "message" in next_data:
                            if session._current_run_task and not session._current_run_task.done():
                                session._current_run_task.cancel()
                                try:
                                    await session._current_run_task
                                except asyncio.CancelledError:
                                    pass
                            session._current_run_task = asyncio.create_task(
                                _run_handle_message(session, next_data["message"])
                            )
                    else:
                        for t in pending:
                            t.cancel()
                            try:
                                await t
                            except (asyncio.CancelledError, Exception):
                                pass
                        session._current_run_task = None
                        break

    except WebSocketDisconnect:
        sid = session.session_id if session else "none"
        print(f"[TSC] Client disconnected (session {sid})")
        if session:
            session.websocket = None
    except Exception as exc:
        traceback.print_exc()
        if session:
            session.websocket = None
            try:
                await websocket.send_json({
                    "event": "on_error",
                    "data": {"error": str(exc)},
                })
            except Exception:
                pass


@app.get("/sessions")
async def list_sessions():
    return [{"id": sid, "prd_path": None} for sid, _s in _sessions.items()]


async def _read_thread_state(session_id: str) -> dict[str, Any]:
    if _checkpointer is None:
        return {"todos": [], "tickets": []}
    out_todos: list[dict[str, Any]] = []
    out_tickets: list[dict[str, Any]] = []
    try:
        config: dict[str, Any] = {"configurable": {"thread_id": session_id}}
        tup = await _checkpointer.aget_tuple(config)
        if not tup or not tup.checkpoint:
            return {"todos": out_todos, "tickets": out_tickets}
        channel_values = tup.checkpoint.get("channel_values") or {}
        if not isinstance(channel_values, dict):
            return {"todos": out_todos, "tickets": out_tickets}
        raw_todos = channel_values.get("todos")
        if isinstance(raw_todos, list) and raw_todos:
            out_todos = _normalize_todos_for_api(raw_todos)
        raw_tickets = channel_values.get("tickets")
        if isinstance(raw_tickets, list) and raw_tickets:
            out_tickets = _normalize_tickets_for_api(raw_tickets)
    except Exception as exc:
        print(f"[TSC] Failed to read checkpoint for {session_id}: {exc}")
    return {"todos": out_todos, "tickets": out_tickets}


def _normalize_todos_for_api(raw: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        result.append({
            "id": t.get("id") or str(uuid.uuid4()),
            "content": t.get("content") or t.get("text") or str(t),
            "status": t.get("status", "pending"),
        })
    return result


def _normalize_tickets_for_api(raw: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        result.append({
            "id": t.get("id") or str(uuid.uuid4()),
            "title": t.get("title") or "",
            "description": t.get("description") or "",
            "assignedTo": t.get("assigned_to") or t.get("assignedTo") or "",
            "status": t.get("status", "todo"),
            "priority": t.get("priority", "medium"),
        })
    return result


@app.get("/sessions/{session_id}/state")
async def get_session_state(session_id: str):
    return await _read_thread_state(session_id)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


def main():
    import uvicorn

    port = int(os.environ.get("TSC_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

if __name__ == "__main__":
    main()
