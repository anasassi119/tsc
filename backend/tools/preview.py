"""Preview tool for dev agents to set the browser preview pane URL."""

from langchain_core.tools import tool


@tool
def set_preview(url: str) -> str:
    """Set the browser preview pane to display the given URL.

    Call this after starting a dev server or completing a build so the user
    can see the result in the browser preview pane. Dev servers are started
    automatically in the background — you do not need to worry about ordering.

    For dev servers:
        set_preview(url="http://localhost:5173")
        set_preview(url="http://localhost:3000")

    For static builds (after `npm run build`, etc.), pass "static":
        set_preview(url="static")

    For backend-only projects (no UI), do NOT call set_preview.

    Args:
        url: The local dev server URL, or "static" after a successful build.
    """
    return f"Preview → {url}"
