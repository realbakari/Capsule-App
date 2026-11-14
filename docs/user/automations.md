# Automations

An automation is a prompt or a command that Capsule sends on a schedule:
"every weekday at 9:00, triage new issues in this repo", or "every night,
run `/flaky-tests` in a worktree". Each run starts a new thread and marks it
unread, so the results wait for you like messages in an inbox.

## Writing one

Automations live under `automations` in a settings file. Your own file
(`~/.capsule/settings.json`) holds yours; they run in the Inbox. A project's
`.capsule/settings.json` or `.capsule/settings.local.json` holds that
project's; they run in that project.

```jsonc
{
  "automations": [
    {
      "id": "triage-issues",
      "name": "Triage new issues",
      "schedule": "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      "prompt": "Triage the issues opened since yesterday and list the ones that need me."
    },
    {
      "id": "nightly-check",
      "name": "Nightly check",
      "schedule": "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0",
      "command": "flaky-tests",
      "workspace": "worktree",
      "profile": "reviewer"
    }
  ]
}
```

- `id` is lowercase letters, digits and dashes. A project's automation with
  the same `id` as one of yours does not hide yours.
- `schedule` is a recurrence rule. `FREQ` is `MINUTELY`, `HOURLY`, `DAILY`,
  `WEEKLY` or `MONTHLY`, with `INTERVAL`, `BYDAY`, `BYHOUR`, `BYMINUTE`,
  `BYMONTHDAY` and `UNTIL`. Times are your computer's local time. An
  automation runs at most every 5 minutes.
- Give exactly one of `prompt` or `command`. A command is one of your
  [commands](./commands.md), named without the slash.
- `profile` starts the thread from a [profile](./profiles.md).
- `workspace: "worktree"` gives each run its own worktree, in a project
  that is a Git repository.
- `"enabled": false` pauses it.

A run sends its prompt or command as if you had typed it, so commands,
[hooks](./hooks.md) and the profile apply, with whichever agent the thread
starts with.

A project's automations run only after you trust the project. Until then
they are listed in Settings as waiting for trust.

## In Settings

Settings → Automations lists every automation for the open project and
yours, with its schedule in words, when it runs next, and how the last run
went, with a link to its thread.

- The switch pauses or resumes it. Capsule writes `enabled` in the file that
  defines it. An automation from a project's shared settings file is paused
  in your local file, so your teammates are not affected.
- **Run now** starts it straight away.
- Pick a template and choose **Add to your settings**, or **Add to** the
  open project, to add a ready-made automation. It is added paused and the
  file opens, so you can read and change it before choosing to resume it.

The command palette (⌘K) has **Run automation** for each one, and
**Automations**.

## When Capsule is closed

Capsule has to be open for an automation to run. A run that was due while
Capsule was closed, or while your computer was asleep, is not replayed
later. Settings shows **Missed while closed** with how many runs were
missed. **Run now** runs it once; **Dismiss** lets them go.

Only one run of an automation happens at a time. If a run is still going
when the next one comes round, that one is skipped, and Settings says so.

## Results

Each run's thread is titled with the automation's name and the time, and
carries an **Automation** mark in the sidebar. It shows as unread until you
open it on this computer.

From a paired phone or browser you can read the automations list and the
threads they started. Pausing, resuming and **Run now** stay on the desktop.
