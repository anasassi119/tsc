# TSC — The Software Company

**TSC** is a local desktop app that runs a multi-agent software engineering workflow: discovery, PRDs, planning, delegation to specialist agents, and verification — powered by [LangChain Deep Agents](https://github.com/langchain-ai/deepagents) (LangGraph) with a FastAPI backend and an Electron + React UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

## Highlights

- **Orchestrator** — Project discovery, PRDs, milestones, delegation via `task()`, structured handoffs
- **Specialist agents** — Database, API, frontend, full-stack, and QA subagents with real file and shell access inside your workspace
- **Human-in-the-loop** — Sensitive file operations require approval before they run
- **Streaming UI** — See agent output and tool use as it happens
- **Local-first** — Runs on your machine; API keys stay in a local SQLite store

## Requirements

| Tool | Notes |
|------|--------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Python](https://www.python.org/) | 3.11+ |
| [uv](https://docs.astral.sh/uv/) | Python dependency manager |

Optional: Docker if you enforce containerized execution for agents (`TSC_REQUIRE_DOCKER`).

## Quick start (development)

```bash
git clone https://github.com/anasassi119/tsc.git
cd tsc
npm install
cd backend && uv sync && cd ..
npm run dev
```

1. Open **Settings** and add at least one LLM provider API key (Anthropic, OpenAI, or OpenRouter).
2. Choose a **workspace** directory where projects will be created.
3. Start a thread and describe what you want to build.

## Building installers

Production builds bundle a frozen Python backend (PyInstaller) and the Electron app.

```bash
npm run build:mac     # macOS — DMG + zip
npm run build:win     # Windows — NSIS + portable
npm run build:linux   # Linux — AppImage + deb
```

Installers and artifacts are written to `release/`. See [`installer/README.md`](installer/README.md) for DMG artwork and code signing notes.

## Updates (GitHub Releases)

Packaged builds include [`electron-updater`](https://www.electron.build/auto-update) configured for this repository (`build.publish` in `package.json` points at `anasassi119/tsc`). In **production** builds, the app checks for updates after launch and uses the OS notification when a newer release is available.

- **Public repo:** no token is required on the user’s machine to **check** for updates.
- **Maintainers — publish a release**
  1. Set `version` in `package.json` (for example `0.2.0`).
  2. Commit and push, then tag: `git tag v0.2.0 && git push origin main && git push origin v0.2.0`.
  3. The [Release workflow](.github/workflows/release.yml) builds macOS, Windows, and Linux and uploads installers to that GitHub Release (uses `GITHUB_TOKEN`).
  4. Alternatively, build locally with a [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) that has `repo` scope:
     `GH_TOKEN=... npm run release:mac` (or `release:win` / `release:linux`).

Release assets must match the version users have installed so `electron-updater` can compare versions correctly.

## Security

- API keys are stored only in local app data (SQLite).
- Agent file access is scoped to the workspace you select; writes go through approval when enabled.
- Shell commands run with your user permissions — use a dedicated workspace and review prompts.

## Contributing

Issues and pull requests are welcome. Please keep changes focused; match existing TypeScript / Python style. Run `npm run lint` before submitting UI changes.

## License

This project is dual-licensed:
- **GPLv3 (Open Source)** — Free to use, modify, and distribute under the condition that any distributed derivative work is also licensed under GPLv3 and includes full source code.

- **Commercial License** — Required if you want to:
- Use this software in a proprietary (closed-source) product
- Avoid GPL obligations
- Distribute without releasing source code If you are building a commercial product and do not want to open-source it, you must obtain a commercial license.
For more info: see [LICENSE](LICENSE).

## Disclaimer

TSC is a tool for assisting development. You are responsible for reviewing generated code, credentials, and commands. This project is not affiliated with LangChain or model providers.
