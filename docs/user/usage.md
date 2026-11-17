# Usage

Open **Usage** from the chart icon at the foot of the sidebar, or choose
**Usage** in the command palette. The page answers
three questions in order: how close you are to your limits, how much you used,
and which agents, projects and models used it. Choose **Today**, **7 days**, **30 days**
or **90 days** at the top; Capsule remembers your choice. **Refresh** rereads
everything on the page.

## Limits

**Limits** shows the allowance an agent last reported for its account: each
window's percentage used and when it resets, as a countdown and a clock time.
A window turns amber at 80% (**near limit**) and red at 100% (**at limit**).
The tick on each bar is where even use across the window would be now, so a
fill past the tick means you are using the allowance faster than it refills.

A report is the agent's last observation, not a live balance. Each card says
when it was observed and labels a report that may be out of date, a clock that
differs from this computer's, or a reset time that has passed. Values above
100% stay visible.

Today, native Muse Code conversations report their limits while they run.
With no report, the card says **No limits reported** and which agent reports
them.
Other agents do not send limits to Capsule. When a turn stops on a limit, the
conversation shows when it resets and offers **Resume at reset**, **Retry
now** and **Continue with another agent**.

When several conversations report limits, choose the one to show. They may use
different accounts, so Capsule never adds their allowances together.

## Tokens

Token figures come from the Claude Code and Codex transcripts on this computer,
so they include sessions you ran outside Capsule. Other agents' transcripts are
not read yet, and the page says so. They are token counts, not a
bill. Prices are not in the transcripts, so **Cost** reads **Not reported**
rather than an estimate.

- **Today** and the range total count every token the model processed: fresh
  input, cache reads, cache writes, output and reasoning.
- **Tokens per day** draws every day in the range, including days with no
  activity. Today's bar is highlighted. Hover a bar for that day's exact
  figures, or open **Daily figures** for the same numbers as a table.
- **By agent**, **By project** and **By type** rank their parts on one scale
  with each part's share. Cache reads are usually most of the total.
- **By project** counts work by the folder each session ran in: a project's
  folders and its conversations' worktrees count toward that project, and work
  anywhere else is summed as **Other folders**. The six largest are named; the
  rest share one row. Folder paths are never shown.
- **By model** lists the fifteen largest models and totals the rest in one
  row.

While a new range loads, the previous figures stay on screen, dimmed. If a
transcript folder cannot be read, the page says which agent is affected and
keeps the totals it could read, marked as possibly incomplete. See
[Diagnostics](./diagnostics.md#usage-coverage) for custom CLI folders.

## Your results

**Your results** at the foot of the page lists what you kept and how you rated
each agent and model when you ran one prompt on several agents. See [Running
one prompt on several agents](./best-of-n.md). It is kept on this computer.

## From another device

A paired device can open Usage and read the same figures. Refreshing there
rereads the host's transcripts and cached limit reports; it never starts an
agent or asks a provider for a new balance.
