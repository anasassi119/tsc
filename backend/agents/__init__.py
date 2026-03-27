"""TSC Agent definitions."""

from agents.dev_team import create_dev_subagents
from agents.orchestrator import ORCHESTRATOR_SYSTEM_PROMPT, create_orchestrator_agent

__all__ = [
    "create_dev_subagents",
    "create_orchestrator_agent",
    "ORCHESTRATOR_SYSTEM_PROMPT",
]
