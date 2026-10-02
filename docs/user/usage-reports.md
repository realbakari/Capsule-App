# Optional usage reports

In **Settings → General → Help improve Capsule**, choose **Share usage reports**
to help the maintainers understand reliability and performance. This is off for
new and existing installations until you turn it on. Browser clients cannot
change this preference on your behalf.

Reports contain a random installation identifier, app version, operating system,
app starts, daily activity on startup or running work, harness category, runtime
route, run outcomes and duration. Capsule's aggregate CPU and memory are sampled
at most once per ten minutes. A missing harness or route is reported as unknown
or other, not guessed. Other applications' process details are not sent.

Reports do not contain prompts, responses, code, titles, paths, account names,
credentials, raw errors, transcripts, or token/cost estimates. There is no click
tracking or session recording. Reports go to the maintainers' US analytics
service over HTTPS; that service sees your network address. Geographic lookup
and person-profile processing are disabled for these events.

The setting shows whether collection is on, queued report count, delivery errors
and the last successful delivery. Failed reports are discarded; an analytics
outage never retries a coding task. Unsent reports stay in memory and are lost
when Capsule closes. No old history is uploaded in bulk.

Turning the switch off stops collection, aborts an in-progress delivery and
discards queued reports. An already received report cannot be recalled. The
local identifier is removed; enabling later creates a different one. Reports
already received are not automatically deleted. See [Privacy](../../PRIVACY.md).

Local Usage and Diagnostics pages work without enabling these reports. Their
figures describe your machine, not a global analytics dashboard.
