# Providers and credentials

Capsule drives coding CLIs that are already installed and signed in on the
machine running the selected route: the Gateway host or this Mac for direct
mode. It does not install them, does not sign
you in, and never resells tokens.

| Provider | Executable |
|----------|-----------|
| Claude Code | `claude` |
| Codex | `codex` |
| Grok Build | `grok` |
| Cursor | `cursor-agent` |
| OpenCode | `opencode` |
| Gemini Flash | `gemini` |
| Gemini CLI | `gemini` |
| GitHub Copilot | `copilot` |

Sign in with each tool's own flow — `claude`, `codex login`, `grok login`, and so on.

If a CLI reports an unsupported sign-in or account, check that tool's setup on
the machine running it. Capsule reports the error; changing its UI settings
cannot repair provider access. Gemini Flash and Gemini CLI use the same binary;
the first pins the Flash model, the second takes the CLI default.

## Choose and check a harness

Open **Harnesses** from the agent picker or type `/runtimes`. The catalog puts
installed agents first. Select one to see its readiness, run **Check this
agent**, make it the default for the current project, or start a persistent or
one-turn session.

The project folder and session lifetime are set once in the bar above the
catalog. An open session appears in the selected agent's detail panel, where
you can refresh status, cancel the current turn, or close it. Gateway sessions
can request supported model, permission, timeout and mode changes. Direct
sessions cannot currently change these live or accept Steer. Unsupported
changes leave the saved setting unchanged and show an error. The live working
folder cannot change: close the agent and start a thread in the desired folder.

When the live agent publishes its available models through ACP, **Model** is a
dropdown containing those exact choices. If the agent does not publish a list,
Capsule shows a model-id field instead. Model ids belong to the selected agent;
Capsule does not reuse one provider's names for another.

Capsule disables **Start a session** when the project has no folder or the route
is not ready. Gateway-only agents need the Gateway and acpx; direct mode needs
a detected native ACP CLI but no Gateway. Both check login when a probe exists.
Run the check shown in the detail panel to see which prerequisite is missing.

## If you want to use an API key instead of a subscription

Capsule has no provider-key entry field. Keys belong to the coding CLI's own
configuration or to the environment of the process that launches it.

Set it where the Gateway starts, or in the environment used to launch Capsule
for a direct agent. Codex reads `CODEX_API_KEY` or
`OPENAI_API_KEY`; Claude Code reads `ANTHROPIC_API_KEY`; Grok Build reads
`XAI_API_KEY`:

```bash
OPENAI_API_KEY=… ANTHROPIC_API_KEY=… XAI_API_KEY=… openclaw gateway run
```

A Gateway installed as a background service does not inherit your shell, so
exporting a variable in a terminal will not reach it.
