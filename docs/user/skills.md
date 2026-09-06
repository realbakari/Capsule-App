# Skills

A skill is a written procedure — a `SKILL.md` file — that you attach to a
conversation so the agent follows it. Type `$` in the composer or choose
**Add context → Skills** to attach one. Search by name, description or source;
the picker keeps similarly named skills from different sources distinct.

The selected skill appears as a removable chip above your message. **Change**
replaces it; Capsule attaches one explicit skill per turn. Selecting with Enter
or Tab works inside a longer message without sending the message. Disabled and
uninstalled skills are not offered. A skill-only message is allowed.

The selection stays with that thread’s draft, survives a restart, and is included
when you stash or restore the prompt. Removing the chip removes the attachment;
it does not leave an invisible skill selection or a duplicate command in the text.

## Finding skills

Open **Skills** to see the **Installed** view first. Capsule scans the standard
global folders used by Agent Skills, Codex, Claude Code, and OpenCode. Each
discovered skill shows its owning CLI; its local location remains available in
the detail view. **Scan again** picks up a skill installed while Capsule is
open.

Skills checked into the current conversation’s folder are included too. A
worktree conversation reads its own skills, not the original checkout’s copy.
The same folder is used when inspecting **Files** and attaching the instructions.
If a selected skill has disappeared, sending fails visibly instead of silently
omitting it.

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

The folder opens `SKILL.md` first. Selecting a different file shows its loading
state and then its own preview. An unreadable file or folder has a **Retry**
control; an empty folder is labelled separately.

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

The token is held in the desktop’s secret store, not its settings database.
Settings shows a mask, and clearing the field removes the saved token. An older
settings copy is migrated when Capsule starts. A token supplied by your launch
environment can still take effect after restarting.

## Installing

Installing fetches the skill's text and stores it with the skill. If that text
cannot be read, Capsule does not install it: a skill without its procedure
would attach to a conversation and do nothing.

**Install & Attach** waits until the instructions have been saved before adding
the skill to chat. Failed installs and removals keep the detail open with an
error you can retry. Pack installation follows the same rule. A skill with the
same name from a different repository is a separate skill.
