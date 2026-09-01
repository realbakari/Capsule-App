# Diagnostics

Settings → Diagnostics shows what Capsule is doing to your machine, and can
export a sanitized report.

## Process monitor

Capsule's own processes — the main process, the window, the GPU helper and any
utility processes — with their CPU, memory, uptime and PID. It samples every two
seconds while the panel is open and stops when you leave it, so watching it
costs nothing once you look away.

The figures are the ones Electron reports for this app. That is the whole
scope: disk throughput per process, thermal state, and CPU speed limits are not
available without a native sampler, which Capsule does not ship, so they are
absent rather than estimated.

The list is sorted by cost, so whatever is making the fan spin is at the top.
