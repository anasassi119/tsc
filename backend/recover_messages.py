"""
One-shot recovery script: reads lost messages from the LangGraph checkpointer
and writes them back into the Electron frontend's SQLite database.

Run with:  uv run python3 recover_messages.py
"""

import asyncio
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

CHECKPOINT_DB = Path(__file__).parent / ".checkpoints" / "state.sqlite"
FRONTEND_DB = Path.home() / "Library" / "Application Support" / "tsc" / "settings.db"

# Threads confirmed to have msgCount > 0 but 0 rows in thread_messages
AFFECTED_THREADS = [
    "c193c078-5194-4d26-b89b-bd2f86b58632",
    "faa36e78-6d5f-4ddf-9701-af659c218a2f",
]


def _content_to_str(content: object) -> str:
    """Return a plain string no matter what shape content arrives in."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
        return "\n".join(p for p in parts if p)
    return str(content)


def _to_frontend_message(msg: object, ts: str) -> dict | None:
    """Convert a LangChain message to the frontend JSON schema."""
    if isinstance(msg, HumanMessage):
        return {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": _content_to_str(msg.content),
            "timestamp": ts,
        }
    if isinstance(msg, AIMessage):
        content = _content_to_str(msg.content)
        return {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": content,
            "timestamp": ts,
            "agentName": msg.name or None,
        }
    return None  # skip ToolMessage, SystemMessage, etc.


async def recover_thread(
    saver: AsyncSqliteSaver,
    thread_id: str,
    front_db: sqlite3.Connection,
) -> None:
    config = {"configurable": {"thread_id": thread_id}}
    tup = await saver.aget_tuple(config)
    if not tup or not tup.checkpoint:
        print(f"  [{thread_id[:8]}] no checkpoint found — skipping")
        return

    raw_msgs = (tup.checkpoint.get("channel_values") or {}).get("messages", [])
    ts_str = tup.checkpoint.get("ts") or datetime.now(timezone.utc).isoformat()

    frontend_msgs: list[dict] = []
    for m in raw_msgs:
        converted = _to_frontend_message(m, ts_str)
        if converted:
            frontend_msgs.append(converted)

    print(f"  [{thread_id[:8]}] {len(raw_msgs)} checkpoint msgs → {len(frontend_msgs)} user/assistant msgs")

    if not frontend_msgs:
        print(f"  [{thread_id[:8]}] nothing to restore")
        return

    # Write to frontend DB inside a transaction (DELETE + re-INSERT)
    cur = front_db.cursor()
    cur.execute("DELETE FROM thread_messages WHERE thread_id = ?", (thread_id,))
    for msg in frontend_msgs:
        cur.execute(
            "INSERT INTO thread_messages (thread_id, data) VALUES (?, ?)",
            (thread_id, json.dumps(msg)),
        )
    front_db.execute(
        "UPDATE threads SET message_count = ?, updated_at = ? WHERE id = ?",
        (len(frontend_msgs), datetime.now(timezone.utc).isoformat(), thread_id),
    )
    front_db.commit()
    print(f"  [{thread_id[:8]}] restored {len(frontend_msgs)} messages ✓")


async def main() -> None:
    print(f"Checkpoint DB : {CHECKPOINT_DB}")
    print(f"Frontend DB   : {FRONTEND_DB}")

    if not CHECKPOINT_DB.exists():
        print("ERROR: checkpoint DB not found")
        return
    if not FRONTEND_DB.exists():
        print("ERROR: frontend DB not found")
        return

    front_db = sqlite3.connect(str(FRONTEND_DB))
    try:
        async with AsyncSqliteSaver.from_conn_string(str(CHECKPOINT_DB)) as saver:
            for tid in AFFECTED_THREADS:
                print(f"\nRecovering thread {tid}…")
                await recover_thread(saver, tid, front_db)
    finally:
        front_db.close()

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
