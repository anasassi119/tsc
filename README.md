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

Packaged builds include [`electron-updater`](https://www.electron.build/auto-update) configured for this repository. When you publish a **GitHub Release** whose tag matches the app version (for example `v0.1.0` and `version` in `package.json`), the app can check for updates and notify when a new release is available.

- **Public repo:** update checks use the GitHub API without extra configuration.
- **Publishing releases:** push a git tag and attach build artifacts, or use the [release workflow](.github/workflows/release.yml) with GitHub Actions.

See **Releases** on GitHub for changelog and downloads.

## Security

- API keys are stored only in local app data (SQLite).
- Agent file access is scoped to the workspace you select; writes go through approval when enabled.
- Shell commands run with your user permissions — use a dedicated workspace and review prompts.

## Contributing

Issues and pull requests are welcome. Please keep changes focused; match existing TypeScript / Python style. Run `npm run lint` before submitting UI changes.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

TSC is a tool for assisting development. You are responsible for reviewing generated code, credentials, and commands. This project is not affiliated with LangChain or model providers.

## Monorepo note

If you keep this project **inside another Git repository** and also use it as its own remote (`anasassi119/tsc`), add this folder to the **parent** repo’s `.gitignore` or use a **submodule**, so you do not track the same files twice.
