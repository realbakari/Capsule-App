# Diagnostics

Settings → Diagnostics shows what Capsule is doing to your machine, and can
export a sanitized report.

## Local performance

Choose **Refresh timings** to inspect event processing, Git operations and local
file previews. Capsule keeps 200 recent samples, 20 slowest samples and totals
per process in memory for the current app session. The screen shows averages,
maximums, counts and errors; expand **Slow samples** for individual timings.
The diagnostics export includes the desktop host and current window's samples.
Nothing is uploaded automatically, and timing samples contain no prompts, file
paths, command arguments or output.

Event timings measure processing, not screen painting or agent response time.
Git queue wait is separate from command duration. Preview timings cover local
reading and decoding, not loading a website. Non-zero Git probes count as errors
even when an absent ref or repository is expected. These measurements help
locate expensive operations; they do not certify that the app cannot freeze.

## Reply limits and history

Capsule limits each retained agent answer to 1 MiB of UTF-8 text, with an 8 MiB
shared budget for active replies. Exceeding a limit marks the turn failed and
requests cancellation. A saved prefix may be incomplete; it is not a verified
result. Check the agent's state before retrying. Cancellation can fail separately.

Streamed answers are saved in batches on substantial growth or a one-second
timer, and flushed when a turn ends. An abrupt crash can lose the latest
unsaved tail. Ask the agent to put large reports in files instead of printing
them into chat.

History loads a page of run summaries at a time. **Older runs** opens the next
page and **Newest runs** returns to recent work. Opening a conversation loads
its recent messages first; earlier exchanges remain available through its
history control. These limits reduce retained work; they do not guarantee that
every large-repository operation is inexpensive.

## Process monitor

Capsule's own processes — the main process, the window, the GPU helper and any
utility processes — appear with their CPU, memory, uptime and PID. Recognized
local agent processes and their children are sampled separately. An agent on
another machine is not included, and a local process match does not establish
which Capsule thread owns it.

Sampling runs every five seconds while Capsule is open, retaining up to fifteen
minutes of history in memory. Process-table reads run in the background and
do not overlap. Leaving Diagnostics does not stop collection.

Above the table, the host conditions that explain it: whether you are on
battery, the thermal state, and whether the session is active, idle or locked.
A machine that is throttling or on battery runs an agent turn slower, and that
looks like the app being slow.

App figures come from Electron; local agent figures come from the operating
system's process table. If that table cannot be read, agent rows are unavailable.
Per-process disk throughput is not measured.

The list is sorted by cost, so whatever is making the fan spin is at the top.
