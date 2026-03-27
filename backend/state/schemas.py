"""LangGraph state schemas for TSC agents."""

from typing import Annotated, TypedDict

from langgraph.graph import add_messages


class Ticket(TypedDict):
    """A development ticket."""
    
    id: str
    title: str
    description: str
    assigned_to: str
    status: str  # todo, in_progress, review, done
    priority: str  # low, medium, high


class Todo(TypedDict):
    """A todo item."""
    
    id: str
    content: str
    status: str  # pending, in_progress, completed, cancelled


class TSCState(TypedDict):
    """Shared state for TSC agents.
    
    This state is passed between the PM, PO, and Dev agents.
    """
    
    messages: Annotated[list, add_messages]
    """Conversation messages."""
    
    prd_path: str | None
    """Path to the PRD.md file."""
    
    tickets: list[Ticket]
    """Development tickets created by PO."""
    
    active_agent: str | None
    """Currently active agent name."""
    
    todos: list[Todo]
    """Global task list."""
    
    workspace_dir: str
    """User's workspace directory."""


class PMState(TSCState):
    """State specific to the PM agent."""
    
    discovery_complete: bool
    """Whether project discovery is complete."""
    
    client_requirements: list[str]
    """Gathered client requirements."""


class POState(TSCState):
    """State specific to the PO agent."""
    
    current_sprint: list[str]
    """Ticket IDs in current sprint."""
    
    blocked_tickets: list[str]
    """IDs of blocked tickets."""
