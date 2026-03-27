# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the TSC backend server.

Run with: uv run pyinstaller server.spec
Output:   dist/server  (single-folder bundle)
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# ── Collect heavy packages that PyInstaller misses via static analysis ─────────
datas = []
binaries = []
hiddenimports = []

for pkg in [
    "deepagents",
    "langgraph",
    "langchain",
    "langchain_core",
    "langchain_anthropic",
    "langchain_openai",
    "langchain_openrouter",
    "langchain_community",
    "fastapi",
    "uvicorn",
    "starlette",
    "anyio",
    "httpx",
    "httpcore",
    "h11",
    "aiosqlite",
    "langgraph_checkpoint_sqlite",
    "pydantic",
    "pydantic_core",
    "dotenv",
]:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# ── Additional hidden imports that static analysis misses ─────────────────────
hiddenimports += [
    # uvicorn/asgi internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "websockets",
    "websockets.legacy",
    "websockets.legacy.server",
    # langgraph checkpoint sqlite
    "langgraph.checkpoint.sqlite",
    "langgraph.checkpoint.sqlite.aio",
    # sqlalchemy (used by some langgraph checkpointers)
    "sqlalchemy.dialects.sqlite",
    # encoding / crypto
    "encodings",
    "encodings.utf_8",
    "encodings.ascii",
    "encodings.latin_1",
]

a = Analysis(
    ["server.py"],
    pathex=[str(Path(".").resolve())],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Save ~50 MB — nothing in the server uses these
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "PIL",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "setuptools",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # one-folder (not one-file) — faster startup
    name="server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="server",
)
