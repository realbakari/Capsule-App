# Claude Code and Codex harnesses

Buzz's desktop catalog treats Claude Code and Codex as first-class ACP runtimes spawned by `buzz-acp`. Capsule mirrors that product idea on OpenClaw instead of copying Buzz's stdio harness.

## What Capsule does

1. Probe this Mac for `claude` and `codex` on `PATH`.
2. Probe the OpenClaw Gateway for the `acpx` plugin.
3. Let you **dedicate** either harness to a project (default coding agent).
4. **Spawn** an ACP session through the Gateway:

   - Prefer `sessions.create` with `runtime: "acp"` and `acp.agent = claude|codex`.
   - Fall back to `/acp spawn <id> --bind here --mode persistent`.

## What Capsule does not do

- Speak ACP JSON-RPC to Claude or Codex over stdio
- Ship `buzz-acp`
- Replace OpenClaw's native Codex plugin (`/codex bind`) — dedicated Codex in Capsule is the explicit ACP path documented by OpenClaw

## Operator setup

```bash
# On the Gateway host
openclaw plugins install @openclaw/acpx
openclaw config set plugins.entries.acpx.enabled true

# On this Mac
# Install and authenticate Claude Code and/or the Codex CLI
```

Then in Capsule: **Runtimes → Dedicate to project / Spawn session**.

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) and [Buzz ACP](https://github.com/block/buzz/blob/main/ARCHITECTURE.md).
