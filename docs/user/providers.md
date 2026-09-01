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
