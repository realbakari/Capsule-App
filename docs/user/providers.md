# Providers and credentials

Capsule drives coding CLIs that are already installed and signed in on the
machine running the OpenClaw Gateway. It does not install them, does not sign
you in, and never resells tokens.

| Provider | Executable |
|----------|-----------|
| Claude Code | `claude` |
| Codex | `codex` |
| Cursor | `cursor-agent` |
| OpenCode | `opencode` |
| Gemini CLI | `gemini` |
| GitHub Copilot | `copilot` |

Sign in with each tool's own flow — `claude`, `codex login`, and so on.

## Choose and check a harness

Open **Harnesses** from the agent picker or type `/runtimes`. The catalog puts
installed agents first. Select one to see its readiness, run **Check this
agent**, make it the default for the current project, or start a persistent or
one-turn session.

The project folder and session lifetime are set once in the bar above the
catalog. An open session appears in the selected agent's detail panel, where
you can refresh its status, cancel the current turn, close it, or update its
permissions, model, timeout, and agent-specific mode.

Capsule disables **Start a session** when the Gateway is disconnected, the
project has no folder, acpx is unavailable, or the CLI still needs sign-in.
Run the check shown in the detail panel to see which prerequisite is missing.

## If you want to use an API key instead of a subscription

Capsule cannot hold that key. It connects to a Gateway that is already running,
and the Gateway is what launches these CLIs, so a key entered in Capsule would
never reach them.

Set it where the Gateway starts instead. Codex reads `CODEX_API_KEY` or
`OPENAI_API_KEY`; Claude Code reads `ANTHROPIC_API_KEY`:

```bash
OPENAI_API_KEY=… ANTHROPIC_API_KEY=… openclaw gateway run
```

A Gateway installed as a background service does not inherit your shell, so
exporting a variable in a terminal will not reach it.
