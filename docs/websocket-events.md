# TSC WebSocket Events

Protocol version: **2** (server constant `PROTOCOL_VERSION`).

## Connection

The client sends a JSON config message immediately after connecting:

```json
{
  "session_id": "optional-uuid",
  "workspace_dir": "/path/to/workspace",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "api_key": "sk-...",
  "project_id": "optional",
  "protocol": 2,
  "initial_todos": []
}
```

`protocol` is optional. When absent, the server defaults to `1` (legacy). The server echoes the negotiated version in `on_session_created` / `on_session_resumed`.

## Events (server → client)

All events follow the shape `{ "event": "<name>", "data": { ... } }`.

### Session lifecycle

| Event | Data | Description |
|-------|------|-------------|
| `on_session_created` | `session_id`, `protocol` | New session initialized |
| `on_session_resumed` | `session_id`, `protocol` | Existing session resumed |

### Agent lifecycle

| Event | Data | Description |
|-------|------|-------------|
| `on_agent_start` | `agent` | Agent turn begins |
| `on_active_agent` | `agent` | Active agent label changed |
| `on_subagent_start` | `agent`, `namespace` | Subagent graph started |
| `on_subagent_end` | `agent` | Subagent graph finished |
| `on_turn_end` | _(empty)_ | Agent turn completed |

### Streaming

| Event | Data | Description |
|-------|------|-------------|
| `on_text_chunk` | `chunk`, `agent`, `scope` | LLM text token(s) |
| `on_tool_call` | `tool_call { id, name, args, agent, scope }` | Tool invocation started |
| `on_tool_result` | `tool_result { id, name, result, status, diff?, diff_path?, agent, scope }` | Tool finished |

### State updates

| Event | Data | Description |
|-------|------|-------------|
| `on_todos_update` | `todos: [{ id, content, status }]` | Todo list changed |
| `on_handoff_report` | `agent, filesModified, commandsRun, decisionsMade, openIssues, verification, summary` | Parsed Handoff Report from a completed `task` tool |

### Approval (HITL)

| Event | Data | Description |
|-------|------|-------------|
| `on_interrupt` | `interrupt { tool_call_id, tool_name, args, message }` | Tool requires user approval |

### Errors

| Event | Data | Description |
|-------|------|-------------|
| `on_error` | `error` | Human-readable error string |

## Messages (client → server)

After the initial config, the client sends JSON messages:

```json
{ "message": "user text" }
```

To cancel the current run:

```json
{ "type": "stop" }
```

To respond to an HITL interrupt:

```json
{ "type": "approve", "tool_call_id": "...", "approved": true }
```

## Scope values

- `main` — Orchestrator (root graph)
- `subagent` — Delegated subagent (nested subgraph)

## Handoff Report contract

The `on_handoff_report` event is emitted when a `task` tool result contains a `## Handoff Report` markdown section. The parser extracts:

- `filesModified` — lines under `### Files Modified`
- `commandsRun` — lines under `### Commands Run`
- `decisionsMade` — lines under `### Decisions Made`
- `openIssues` — lines under `### Open Issues`
- `verification` — key/value pairs under `### Verification` (e.g. `{ "build": "PASS", "tests": "N/A" }`)
- `summary` — text under `### Summary`

Section headers are stable and defined in `agents/dev_team.py::HANDOFF_REPORT`.
