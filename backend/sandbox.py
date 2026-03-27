"""Per-project sandbox backends for TSC.

Provides two isolation tiers:

1. `DockerProjectSandbox` — true isolation via Docker container per project.
   The workspace is bind-mounted at `/workspace`; commands run inside the
   container and cannot access the host filesystem outside the mount.

2. `RestrictedLocalBackend` — soft sandboxing when Docker is unavailable.
   Forces cwd to the workspace root on every command and restricts the
   environment. Not security-grade: commands CAN still reference absolute
   paths, but it prevents accidental drift (the most common problem).
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import threading
import uuid
from pathlib import Path
from typing import ClassVar

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import ExecuteResponse

_BACKGROUND_CAPTURE_SECS = 5

# Commands that run indefinitely — automatically backgrounded (timeout=0)
# regardless of what the agent passes, so they survive after the tool returns.
_DEV_SERVER_PATTERNS: tuple[str, ...] = (
    "npm run dev",
    "npm run start",
    "npm start",
    "npx vite",
    "yarn dev",
    "yarn start",
    "pnpm dev",
    "pnpm start",
    "vite",
    "next dev",
    "nuxt dev",
    "uvicorn",
    "fastapi dev",
    "flask run",
    "python -m http.server",
    "python3 -m http.server",
    "node server",
    "nodemon",
    "bun dev",
    "bun run dev",
    "deno run",
)


def _is_dev_server_command(command: str) -> bool:
    """Return True if the command looks like a long-running dev server."""
    lower = command.lower()
    return any(pat in lower for pat in _DEV_SERVER_PATTERNS)


def _capture_background_output(
    proc: subprocess.Popen[str],
    capture_secs: int = _BACKGROUND_CAPTURE_SECS,
    max_bytes: int = 100_000,
) -> ExecuteResponse:
    """Start a long-running process, capture its initial output, then detach.

    Used when the agent passes ``timeout=0`` (background/no-wait mode) for
    commands like dev servers that run indefinitely. We read stdout/stderr
    for `capture_secs` seconds so the agent can confirm the server started,
    then return without killing the process.
    """
    import select
    import time

    chunks: list[str] = []
    total = 0
    fds: dict[int, str] = {}

    if proc.stdout and proc.stdout.fileno() >= 0:
        fd = proc.stdout.fileno()
        os.set_blocking(fd, False)
        fds[fd] = "out"
    if proc.stderr and proc.stderr.fileno() >= 0:
        fd = proc.stderr.fileno()
        os.set_blocking(fd, False)
        fds[fd] = "err"

    deadline = time.monotonic() + capture_secs
    while time.monotonic() < deadline:
        remaining = max(0.05, deadline - time.monotonic())
        readable, _, _ = select.select(list(fds.keys()), [], [], remaining)
        if not readable:
            if proc.poll() is not None:
                break
            continue
        for fd in readable:
            try:
                raw = os.read(fd, 4096)
            except OSError:
                continue
            if not raw:
                continue
            text = raw.decode("utf-8", errors="replace")
            prefix = "[stderr] " if fds[fd] == "err" else ""
            for line in text.splitlines(keepends=True):
                chunks.append(prefix + line)
            total += len(text)
        if total >= max_bytes:
            break
        if proc.poll() is not None:
            break

    output = "".join(chunks) or "<process started in background>"
    if len(output) > max_bytes:
        output = output[:max_bytes] + "\n\n... Output truncated."

    exited = proc.poll() is not None
    exit_code = proc.returncode if exited else 0
    if not exited:
        output += f"\n\n(process still running, pid={proc.pid})"
    return ExecuteResponse(output=output, exit_code=exit_code)


# ── Dangerous pattern detection (ported from libs/cli config.py) ────

DANGEROUS_SHELL_PATTERNS: tuple[str, ...] = (
    "$(",
    "`",
    "$'",
    "\n",
    "\r",
    "\t",
    "<(",
    ">(",
    "<<<",
    "<<",
    "${",
)

_DANGEROUS_DOLLAR_RE = re.compile(r"\$[A-Za-z_]")


def _contains_dangerous_patterns(command: str) -> str | None:
    """Return a description if the command contains injection-risk patterns.

    Mirrors the CLI's `contains_dangerous_patterns` guard. Returns `None`
    when the command is safe. Backgrounding (`&`) and simple redirects
    (`>`, `>>`) are allowed since the agent legitimately uses them for
    dev servers and log capture.
    """
    for pat in DANGEROUS_SHELL_PATTERNS:
        if pat in command:
            return f"blocked pattern: {pat!r}"
    if _DANGEROUS_DOLLAR_RE.search(command):
        return "blocked pattern: $VAR expansion"
    return None


# ── Docker availability ─────────────────────────────────────────────

_docker_checked = False
_docker_available = False


def is_docker_available() -> bool:
    """Check whether the Docker daemon is running and accessible."""
    global _docker_checked, _docker_available  # noqa: PLW0603
    if _docker_checked:
        return _docker_available
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        _docker_available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        _docker_available = False
    _docker_checked = True
    return _docker_available


# ── Path sanitization ───────────────────────────────────────────────


def _sanitize_workspace_paths(output: str, workspace_path: str) -> str:
    """Replace absolute workspace paths in shell output with ``/``.

    The agent uses virtual paths (``/src/app.py``) for file operations.
    Shell commands expose the real absolute path (Docker's ``/workspace``
    or the host path). If the agent sees those and reuses them in file
    tool calls, ``virtual_mode`` resolves them as nested subdirectories
    (e.g. ``{root}/workspace/src/app.py``). Sanitizing the output keeps
    paths consistent between shell and file tools.
    """
    if not workspace_path:
        return output
    output = output.replace(workspace_path + "/", "/")
    output = output.replace(workspace_path, "/")
    return output


_SYSTEM_PATH_ROOTS: frozenset[str] = frozenset({
    "usr", "bin", "etc", "var", "tmp", "dev", "proc", "sys", "home", "opt",
    "lib", "lib64", "sbin", "root", "nix", "snap", "boot", "run", "srv",
    "mnt", "media", "private", "Library", "System", "Applications", "Volumes",
    "Users", "cores", "AppleInternal",
})


def _resolve_virtual_paths(
    command: str,
    workspace: Path,
) -> str:
    """Translate virtual absolute paths in a shell command to real paths.

    File tools present ``/`` as the workspace root (``virtual_mode``).
    Shell commands run on the real filesystem where ``/`` is the OS root.
    When the agent reuses a virtual path like ``/src/app.tsx`` in a shell
    command, it fails because the real ``/src/`` does not exist.

    This function detects virtual-style absolute paths whose first component
    exists inside the workspace but NOT on the real filesystem, and rewrites
    them as workspace-relative paths (the shell's CWD is already the
    workspace root).

    System paths (``/usr``, ``/bin``, ``/Users``, etc.) are never rewritten.
    """
    if "/" not in command:
        return command

    try:
        workspace_entries = {e.name for e in workspace.iterdir()}
    except OSError:
        return command
    if not workspace_entries:
        return command

    escaped = sorted((re.escape(e) for e in workspace_entries), key=len, reverse=True)
    pattern = r"(?<![a-zA-Z0-9_.\-])/(" + "|".join(escaped) + r")(?=/|\s|$|\"|'|;|&&|\|\||\))"

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in _SYSTEM_PATH_ROOTS:
            return match.group(0)
        return name

    return re.sub(pattern, _replace, command)


# ── Docker sandbox ──────────────────────────────────────────────────


class DockerProjectSandbox(LocalShellBackend):
    """Docker-based project sandbox.

    File operations (read, write, edit, ls, grep, glob) use the host
    filesystem directly via the parent `LocalShellBackend`. Shell commands
    run inside a Docker container whose only mount is the project workspace
    at ``/workspace``.

    This gives true filesystem isolation for executed commands while
    keeping file operations fast and reliable (no `docker cp` overhead).

    Shell output is sanitized: ``/workspace`` paths are replaced with ``/``
    so the agent sees consistent virtual paths matching the file tools.
    """

    DEFAULT_IMAGE: ClassVar[str] = "node:20-slim"
    _CONTAINER_WORKDIR: ClassVar[str] = "/workspace"

    SHELL_TIMEOUT: ClassVar[int] = 60

    def __init__(
        self,
        workspace_dir: str,
        *,
        image: str | None = None,
        timeout: int | None = None,
        max_output_bytes: int = 100_000,
    ) -> None:
        effective_timeout = timeout if timeout is not None else self.SHELL_TIMEOUT
        super().__init__(
            root_dir=workspace_dir,
            virtual_mode=True,
            inherit_env=False,
            timeout=effective_timeout,
            max_output_bytes=max_output_bytes,
        )
        self._workspace = Path(workspace_dir).resolve()
        self._image = image or self.DEFAULT_IMAGE
        self._container_name = f"tsc-{self._workspace.name}-{uuid.uuid4().hex[:8]}"
        self._container_id: str | None = None
        self._exec_lock = threading.Lock()
        self._active_exec: subprocess.Popen | None = None

    @property
    def id(self) -> str:
        return f"docker:{self._container_id or self._container_name}"

    # ── Container lifecycle ────────────────────────────────────────

    def _ensure_container(self) -> str:
        """Return a running container id, creating one if needed."""
        if self._container_id:
            try:
                probe = subprocess.run(
                    ["docker", "inspect", "-f", "{{.State.Running}}", self._container_id],
                    capture_output=True, text=True, timeout=5,
                )
                if probe.returncode == 0 and "true" in probe.stdout.lower():
                    return self._container_id
            except (subprocess.TimeoutExpired, OSError):
                pass
            self._container_id = None

        subprocess.run(
            ["docker", "rm", "-f", self._container_name],
            capture_output=True, timeout=10,
        )

        result = subprocess.run(
            [
                "docker", "run", "-d",
                "--name", self._container_name,
                "-v", f"{self._workspace}:/workspace",
                "-w", "/workspace",
                "--network", "host",
                self._image,
                "tail", "-f", "/dev/null",
            ],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Docker container creation failed: {result.stderr.strip()}")

        self._container_id = result.stdout.strip()
        print(f"[Sandbox] Container {self._container_name} created ({self._container_id[:12]})")
        return self._container_id

    def cleanup(self) -> None:
        """Stop and remove the Docker container."""
        cid = self._container_id
        if not cid:
            return
        self._container_id = None
        try:
            subprocess.run(["docker", "rm", "-f", cid], capture_output=True, timeout=15)
            print(f"[Sandbox] Container {self._container_name} removed")
        except (subprocess.TimeoutExpired, OSError) as exc:
            print(f"[Sandbox] Failed to remove container: {exc}")

    _SIGTERM_GRACE: ClassVar[int] = 5

    def interrupt_execute(self) -> None:
        """SIGTERM -> grace period -> SIGKILL escalation (mirrors CLI)."""
        with self._exec_lock:
            proc = self._active_exec
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=self._SIGTERM_GRACE)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        finally:
            with self._exec_lock:
                if self._active_exec is proc:
                    self._active_exec = None

    # ── Execute override ───────────────────────────────────────────

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        if not command or not isinstance(command, str):
            return ExecuteResponse(output="Error: Command must be a non-empty string.", exit_code=1)

        danger = _contains_dangerous_patterns(command)
        if danger is not None:
            return ExecuteResponse(
                output=f"Error: Command rejected — {danger}. "
                "Rewrite using only simple commands without shell expansion.",
                exit_code=1,
            )

        # Auto-background dev servers so they survive after the tool returns
        if _is_dev_server_command(command):
            timeout = 0

        effective_timeout = timeout if timeout is not None else self._default_timeout
        if effective_timeout < 0:
            msg = f"timeout must be non-negative, got {effective_timeout}"
            raise ValueError(msg)

        try:
            container_id = self._ensure_container()
        except RuntimeError as exc:
            return ExecuteResponse(output=str(exc), exit_code=1)

        command = _resolve_virtual_paths(command, self._workspace)

        proc = subprocess.Popen(
            ["docker", "exec", "-w", "/workspace", container_id, "/bin/sh", "-c", command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        with self._exec_lock:
            self._active_exec = proc

        if effective_timeout == 0:
            resp = _capture_background_output(proc, max_bytes=self._max_output_bytes)
            resp = ExecuteResponse(
                output=_sanitize_workspace_paths(resp.output, self._CONTAINER_WORKDIR),
                exit_code=resp.exit_code,
                truncated=resp.truncated,
            )
            return resp

        try:
            try:
                out, err = proc.communicate(timeout=effective_timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate(timeout=5)
                return ExecuteResponse(
                    output=f"Error: Command timed out after {effective_timeout}s: {command[:200]}",
                    exit_code=124,
                    truncated=True,
                )

            parts: list[str] = []
            if out:
                parts.append(out)
            if err:
                for line in err.strip().split("\n"):
                    parts.append(f"[stderr] {line}")

            output = "\n".join(parts) if parts else "<no output>"
            exit_code = proc.returncode if proc.returncode is not None else 1

            truncated = False
            if len(output) > self._max_output_bytes:
                output = output[: self._max_output_bytes]
                output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
                truncated = True

            if exit_code != 0:
                output = f"{output.rstrip()}\n\nExit code: {exit_code}"

            output = _sanitize_workspace_paths(output, self._CONTAINER_WORKDIR)
            return ExecuteResponse(output=output, exit_code=exit_code, truncated=truncated)

        except Exception as exc:  # noqa: BLE001
            return ExecuteResponse(
                output=f"Error executing command ({type(exc).__name__}): {exc}",
                exit_code=1,
            )
        finally:
            with self._exec_lock:
                if self._active_exec is proc:
                    self._active_exec = None


# ── Restricted local fallback ───────────────────────────────────────


class RestrictedLocalBackend(LocalShellBackend):
    """Soft-sandboxed local backend (fallback when Docker is unavailable).

    Every command is wrapped so it always starts in the workspace directory.
    A restricted ``PATH`` is injected to limit discoverable binaries.  The
    host env is NOT inherited, which prevents accidental credential leakage.

    This is **not** security-grade isolation — an agent can still reference
    absolute paths — but it prevents the most common problem: agents
    accidentally drifting out of the workspace.
    """

    _SAFE_PATH: ClassVar[str] = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    SHELL_TIMEOUT: ClassVar[int] = 60

    def __init__(
        self,
        workspace_dir: str,
        *,
        timeout: int | None = None,
        max_output_bytes: int = 100_000,
    ) -> None:
        effective_timeout = timeout if timeout is not None else self.SHELL_TIMEOUT
        self._workspace_str = str(Path(workspace_dir).resolve())

        env = os.environ.copy()
        env["HOME"] = self._workspace_str
        env.setdefault("PATH", self._SAFE_PATH)

        super().__init__(
            root_dir=workspace_dir,
            virtual_mode=True,
            inherit_env=False,
            env=env,
            timeout=effective_timeout,
            max_output_bytes=max_output_bytes,
        )
        self._exec_lock = threading.Lock()
        self._active_proc: subprocess.Popen | None = None

    _SIGTERM_GRACE: ClassVar[int] = 5

    def interrupt_execute(self) -> None:
        """SIGTERM -> grace period -> SIGKILL escalation (mirrors CLI)."""
        with self._exec_lock:
            proc = self._active_proc
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=self._SIGTERM_GRACE)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        finally:
            with self._exec_lock:
                if self._active_proc is proc:
                    self._active_proc = None

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        if not command or not isinstance(command, str):
            return ExecuteResponse(output="Error: Command must be a non-empty string.", exit_code=1)

        danger = _contains_dangerous_patterns(command)
        if danger is not None:
            return ExecuteResponse(
                output=f"Error: Command rejected — {danger}. "
                "Rewrite using only simple commands without shell expansion.",
                exit_code=1,
            )

        # Auto-background dev servers so they survive after the tool returns
        if _is_dev_server_command(command):
            timeout = 0

        effective_timeout = timeout if timeout is not None else self._default_timeout
        if effective_timeout < 0:
            msg = f"timeout must be non-negative, got {effective_timeout}"
            raise ValueError(msg)

        command = _resolve_virtual_paths(command, Path(self._workspace_str))

        workspace = shlex.quote(self._workspace_str)
        wrapped = f"cd {workspace} && {command}"

        proc = subprocess.Popen(  # noqa: S602
            wrapped,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self._env,
            cwd=str(self.cwd),
        )
        with self._exec_lock:
            self._active_proc = proc

        if effective_timeout == 0:
            resp = _capture_background_output(proc, max_bytes=self._max_output_bytes)
            resp = ExecuteResponse(
                output=_sanitize_workspace_paths(resp.output, self._workspace_str),
                exit_code=resp.exit_code,
                truncated=resp.truncated,
            )
            return resp

        try:
            try:
                out, err = proc.communicate(timeout=effective_timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate(timeout=5)
                return ExecuteResponse(
                    output=(
                        f"Error: Command timed out after {effective_timeout} seconds. "
                        "The command may be stuck or require more time."
                    ),
                    exit_code=124,
                    truncated=False,
                )

            output_parts: list[str] = []
            if out:
                output_parts.append(out)
            if err:
                stderr_lines = err.strip().split("\n")
                output_parts.extend(f"[stderr] {line}" for line in stderr_lines)

            output = "\n".join(output_parts) if output_parts else "<no output>"
            exit_code = proc.returncode if proc.returncode is not None else 1

            truncated = False
            if len(output) > self._max_output_bytes:
                output = output[: self._max_output_bytes]
                output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
                truncated = True

            if exit_code != 0:
                output = f"{output.rstrip()}\n\nExit code: {exit_code}"

            output = _sanitize_workspace_paths(output, self._workspace_str)
            return ExecuteResponse(output=output, exit_code=exit_code, truncated=truncated)
        except Exception as exc:  # noqa: BLE001
            return ExecuteResponse(
                output=f"Error executing command ({type(exc).__name__}): {exc}",
                exit_code=1,
                truncated=False,
            )
        finally:
            with self._exec_lock:
                if self._active_proc is proc:
                    self._active_proc = None
