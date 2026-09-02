# Skills

A skill is a written procedure — a `SKILL.md` file — that you attach to a
conversation so the agent follows it. Type `$` in the composer to attach one.

## Finding skills

Open **Skills** to see the **Installed** view first. Capsule scans the standard
global folders used by Agent Skills, Codex, Claude Code, and OpenCode. Each
discovered skill shows its owning CLI; its local location remains available in
the detail view. **Scan again** picks up a skill installed while Capsule is
open.

Global skills remain owned by their CLI: Capsule can inspect and attach them,
but it does not move or uninstall their files. Skills installed through
Capsule appear separately in **Capsule library**. Long installed lists start
with a compact preview; **Show all** expands the rest.

Selecting a skill opens its guidance as rendered Markdown, without the YAML
frontmatter. **Source** shows the original `SKILL.md` when you need to inspect
the exact file. **Files** opens a read-only folder tree and in-place preview for
the complete downloaded skill folder, including references, scripts, images,
and supporting documents. Capsule-managed skills that are stored in the
library expose their `SKILL.md` there.

**Browse GitHub** lists skills read live from the repositories that
publish them. Names come from the repository, descriptions from each skill's
own file. The compact list opens detail on row selection and installs from the
single action at the right. No account or key is needed. GitHub links open in
Capsule's embedded Browser.

**Packs** uses the same compact list. Open a row to inspect its included skills
or install the whole pack from the row action; install commands stay in the
detail view instead of repeating on every row.

The list is cached, because GitHub allows a limited number of anonymous
requests per hour for your whole machine. If a refresh fails, Capsule keeps
showing the last catalog it loaded and says why it could not update, rather
than showing you an empty page. **Refresh** forces a new fetch.

## skills.sh

Optional. skills.sh requires a Vercel OIDC token on every request, so Capsule
reads GitHub unless you add one in **Settings → Skills**. With a token, its
results appear first and carry install counts. If the token is rejected — they
expire roughly every 12 hours — the directory says so.

## Installing

Installing fetches the skill's text and stores it with the skill. If that text
cannot be read, Capsule does not install it: a skill without its procedure
would attach to a conversation and do nothing.
