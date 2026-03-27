# TSC Backend - DeepAgents SDK Integration

This document explains how TSC (The Software Company) uses the **DeepAgents SDK** for multi-agent orchestration. TSC does **not** re-implement any SDK functionality—it directly uses the SDK's built-in tools and middleware.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TSC Backend                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────┐         ┌─────────────────────┐   │
│  │   Orchestrator Agent               │────────▶│   Dev Team          │   │
│  │   (discovery, PRD, delegation)     │         │   (Subagents)       │   │
│  └────────┬──────────────────────────┘         │   • backend-db      │   │
│           │                                     │   • backend-api     │   │
│           │                                     │   • frontend        │   │
│           │                                     │   • fullstack       │   │
│           ▼                                     │   • qa              │   │
│  ┌────────────────────────────────────────────┐  └─────────────────────┘   │
│  │            LocalShellBackend               │                             │
│  │         (from deepagents SDK)              │                             │
│  └────────────────────────────────────────────┘                             │
│                         │                                                   │
│                         ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                  SDK Middleware (auto-injected)                    │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │    │
│  │  │FilesystemMiddleware│  │SubAgentMiddleware│  │TodoListMiddleware│   │    │
│  │  └──────────────────┘  └──────────────────┘  └────────────────┘   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                         │                                                   │
│                         ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    Built-in Tools (auto-provided)                   │    │
│  │  ls • read_file • write_file • edit_file • glob • grep             │    │
│  │  execute • write_todos • task                                       │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## DeepAgents SDK Components Used

### 1. `create_deep_agent()` - Agent Factory

The primary function for creating agents with automatic middleware injection.

**Location in SDK:** `deepagents.graph`

**TSC Usage (agents/orchestrator.py):**

```python
from deepagents import create_deep_agent
from agents.dev_team import create_dev_subagents

def create_orchestrator_agent(doc_backend, dev_backend, model: str, *, checkpointer=None):
    subagents = create_dev_subagents(dev_backend, model)
    return create_deep_agent(
        model=model,
        system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
        backend=doc_backend,
        subagents=subagents,
        checkpointer=checkpointer,
        name="Orchestrator",
    )
```

### 2. `LocalShellBackend` - Sandboxed Execution Environment

Provides secure filesystem and shell access within a specified directory.

**Location in SDK:** `deepagents.backends`

**TSC Usage (tools/workspace.py):**

```python
from deepagents.backends import LocalShellBackend

def create_workspace_backend(workspace_dir: str) -> LocalShellBackend:
    return LocalShellBackend(
        root_dir=workspace_dir,       # All operations sandboxed here
        virtual_mode=True,            # Sandbox enforcement
        inherit_env=True,             # Pass environment variables
        timeout=120,                  # Command timeout
        max_output_bytes=100_000,     # Output size limit
    )
```

### 3. Subagent Configuration

The SDK's `SubAgentMiddleware` is automatically added when `subagents` are passed to `create_deep_agent()`.

**TSC Usage:** `create_dev_subagents()` in `agents/dev_team.py` returns compiled subagent runnables (with `set_preview` for the UI). The orchestrator passes them to `create_deep_agent(..., subagents=...)`.

### 4. Workspace Manifest (`/.tsc/manifest.json`)

The Orchestrator writes a JSON manifest to `/.tsc/manifest.json` after the PRD phase. It contains:
- `phase`, `stack`, `designBriefSummary`, `prdPath`, `apiContractPath`
- `milestones` — keyed by id (e.g. `M1`), each with `title`, `status`, `agent`, optional `blockedBy`, and `files`
- `issues` — blockers surfaced by subagents

Subagents read the manifest before starting work and update their milestone status on completion. The Orchestrator reads it before every decision, replacing the earlier fragile "PRD checkboxes + write_todos" dual tracking.

## Tools Automatically Provided by SDK

When you call `create_deep_agent()`, the SDK's middleware automatically injects these tools—**TSC does not define them manually**:

| Tool | Source Middleware | Description |
|------|-------------------|-------------|
| `ls` | FilesystemMiddleware | List directory contents |
| `read_file` | FilesystemMiddleware | Read file contents |
| `write_file` | FilesystemMiddleware | Create/overwrite files |
| `edit_file` | FilesystemMiddleware | Make targeted edits to files |
| `glob` | FilesystemMiddleware | Find files by pattern |
| `grep` | FilesystemMiddleware | Search file contents |
| `execute` | FilesystemMiddleware | Run shell commands |
| `write_todos` | TodoListMiddleware | Manage todo/task lists |
| `task` | SubAgentMiddleware | Delegate work to subagents |

## Human-in-the-Loop (HITL)

The SDK provides HITL via the `interrupt_on` parameter:

```python
create_deep_agent(
    ...
    interrupt_on={
        "write_file": True,   # Interrupt before writing files
        "edit_file": True,    # Interrupt before editing files
    },
)
```

When an agent attempts to use these tools, the SDK pauses execution and emits an interrupt event that TSC's frontend can capture for user approval.

## Event Streaming

TSC uses LangGraph `astream(..., stream_mode=["messages", "updates"], version="v2", subgraphs=True)` and maps stream parts to WebSocket events:

- `on_text_chunk` — main-agent LLM tokens
- `on_tool_call` / `on_tool_result` — tool lifecycle (with optional unified `diff` for file edits)
- `on_todos_update` — todo list updates from graph state
- `on_subagent_start` / `on_subagent_end` — subagent lifecycle boundaries
- `on_handoff_report` — parsed Handoff Report when a subagent `task` completes (files, verification, issues)
- `on_turn_end` — end of one model turn

## What TSC Implements (vs SDK)

| TSC Custom Code | Purpose |
|-----------------|---------|
| `server.py` | WebSocket server to bridge frontend ↔ SDK |
| `agents/orchestrator.py` | Merged orchestrator (PRD + delegation) and subagent wiring |
| `agents/dev_team.py` | Dev team subagent prompts |
| `file_ops_tsc.py` | File op tracking and unified diffs for the UI |
| `state/schemas.py` | TypedDict for TSC-specific state |

| SDK-Provided (NOT re-implemented) | |
|-----------------------------------|--|
| File operations (ls, read_file, write_file, edit_file, glob, grep) | ✅ |
| Shell execution (execute) | ✅ |
| Todo management (write_todos) | ✅ |
| Subagent delegation (task) | ✅ |
| HITL interrupts | ✅ |
| Event streaming | ✅ |

## Running the Backend

```bash
cd backend
uv sync  # Install dependencies
uv run python server.py
```

The server starts on port 8765 (configurable via `TSC_PORT` environment variable).

## Dependencies

From `pyproject.toml`:

```toml
dependencies = [
    "deepagents>=0.3.0",          # Core SDK
    "langchain-anthropic>=0.3.0",  # Anthropic provider
    "langchain-openai>=0.3.0",     # OpenAI provider
    "fastapi>=0.115.0",            # WebSocket server
    "uvicorn>=0.32.0",             # ASGI server
    "websockets>=13.0",            # WebSocket support
]
```

## Summary

TSC is a thin orchestration layer that:

1. **Uses** `create_deep_agent()` to create agents with built-in tools
2. **Uses** `LocalShellBackend` for sandboxed file/shell access
3. **Configures** `interrupt_on` for human-in-the-loop file writes
4. **Defines** subagents as simple dicts that the SDK transforms into the `task` tool
5. **Streams** events via the SDK's `astream_events()` to the frontend

All file operations, shell commands, todo management, and subagent delegation use the SDK's built-in implementations—no wheel reinvention.
