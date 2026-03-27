"""Workspace tools for TSC agents."""

import os

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import SandboxBackendProtocol

from sandbox import RestrictedLocalBackend

_docker_status_logged = False


def create_workspace_backend(workspace_dir: str) -> SandboxBackendProtocol:
    """Create a workspace backend for dev agents.

    Uses RestrictedLocalBackend — forces cwd to the workspace root on every
    command and restricts the environment. Docker isolation is intentionally
    disabled: this is a local dev tool where the user controls their own machine.

    Args:
        workspace_dir: The user's workspace directory path.

    Returns:
        A backend scoped to the workspace.
    """
    global _docker_status_logged  # noqa: PLW0603

    if not _docker_status_logged:
        print("[TSC] Using RestrictedLocalBackend")
        _docker_status_logged = True
    return RestrictedLocalBackend(workspace_dir)


def create_readonly_backend(workspace_dir: str) -> FilesystemBackend:
    """Create a filesystem-only workspace backend with no shell access.

    Used by PM and PO agents that should read/write documents but
    never execute commands or directly implement code.

    virtual_mode=True ensures all paths (like `/PRD.md`) are resolved
    relative to the workspace root, not the actual filesystem root.
    
    Args:
        workspace_dir: The user's workspace directory path.
        
    Returns:
        A FilesystemBackend configured for the workspace.
    """
    return FilesystemBackend(root_dir=workspace_dir, virtual_mode=True)
