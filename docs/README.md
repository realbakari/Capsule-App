# Capsule docs

Split by audience, because the two readerships need different things and mixing
them means neither is served: a user reading about permission modes does not
need a source path, and a contributor reading about the ACP boundary does not
need the shipped-product voice.

## Using Capsule

- [Your first conversation](./user/getting-started.md)
- [Keyboard shortcuts](./user/keyboard-shortcuts.md)
- [Skills](./user/skills.md)
- [Restoring a turn](./user/checkpoints.md)
- [Checking a turn](./user/verification.md)
- [Drafts, attachments, and prompt stash](./user/composer.md)
- [Projects, actions, and local previews](./user/projects-and-previews.md)
- [capsule.json — project config in the repository](./user/project-file.md)
- [Providers and credentials](./user/providers.md)
- [Reading from another device](./user/reading-from-another-device.md)
- [Updating](./user/updating.md)
- [Diagnostics](./user/diagnostics.md)

## Working on Capsule

Setup is in the [root README](../README.md); agent rules in
[AGENTS.md](../AGENTS.md); the design document in
[ARCHITECTURE.md](../ARCHITECTURE.md).

- [Desktop product spec](./internals/desktop.md) — the UI, kept in lockstep with the app
- [ACP harnesses](./internals/harness.md)
- [OpenClaw notes](./internals/openclaw.md)
- [Architecture pointer](./internals/architecture.md)

## Where a change belongs

- Behaviour a user would notice → `docs/user/`, in shipped-product voice, with
  no repo tooling or source paths.
- Architecture, boundaries and contributor-facing decisions → `docs/internals/`.
- Anything the UI shows → also `docs/internals/desktop.md`. If the app and that
  file disagree, fix both in the same change.
