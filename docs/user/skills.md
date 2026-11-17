# Skills

A skill is a written procedure — a `SKILL.md` file — that you attach to a
conversation so the agent follows it. Type `$` in the composer, or `/` and the
skill's name, to attach one. Search by name, description or source;
the picker keeps similarly named skills from different sources distinct.

The selected skill appears as a removable chip above your message. **Change**
replaces it; Capsule attaches one explicit skill per turn. Selecting with Enter
or Tab works inside a longer message without sending the message. Disabled and
uninstalled skills are not offered. A skill-only message is allowed.

The selection stays with that thread’s draft, survives a restart, and is included
when you stash or restore the prompt. Removing the chip removes the attachment;
it does not leave an invisible skill selection or a duplicate command in the text.

## Finding skills

Open **Skills** from the command palette or with ⇧⌘S. **Installed** is one
list of every skill you can attach, with one count: the skills in the global
folders that Agent Skills, Codex, Claude Code and OpenCode read, the ones
checked into the current conversation's folder (`.claude/skills` and
`.agents/skills`), the ones a plugin brings, and the ones you installed from
the catalog. The list is sorted by name, and searching puts the closest name
first.

A row shows the skill's name and description. Where two skills share a name,
each also says where it came from, so you can tell them apart. Select a row,
or move to it with the arrow keys and press Enter, to open its detail. The
refresh button beside the tabs scans the folders again, for a skill you
installed while Capsule was open.

A worktree conversation reads its own skills, not the original checkout's
copy. Project skills belong to their folder, not only to their name: after
changing the conversation's folder, reselect the skill from that folder.
Capsule will not substitute a same-named skill from another checkout. If a
selected skill has disappeared, sending fails visibly instead of silently
omitting it.

## A skill's detail

The detail names where the skill came from and, for a skill on disk, its
folder. **Instructions** shows the guidance as rendered Markdown, without the
YAML frontmatter. **SKILL.md** shows the original file. **Files** opens a
read-only tree of the skill's folder with an in-place preview of references,
scripts, images and other documents, starting with `SKILL.md`. An unreadable
file or folder has a **Retry** control.

**Attach to message** attaches the skill to your next message and returns to
the conversation; **Remove from message** takes it off again. Escape closes
the detail.

Skills in another agent's folder stay owned by that agent: Capsule reads and
attaches them, and never moves or deletes their files. Skills you installed
from the catalog have **Uninstall**.

## How a skill reaches the agent

Capsule sends the skill's instructions with your message, after your words,
under a line naming the skill. For a skill on disk it also names the skill's
folder, so the agent can open the scripts and references the instructions
point to. This works the same with every agent and on both the direct and the
Gateway route, including a skill from one agent's folder used with another
agent. Only `SKILL.md` travels with the message; the other files stay where
they are, and an agent running on another machine cannot open them.

Nothing is attached unless you attach it.

## Browse GitHub

**Browse GitHub** lists skills read live from the repositories that publish
them. Names come from the repository, descriptions from each skill's own
file, and each row names its repository. Select a row to read the skill
before installing it, or use **Install** on the row. No account or key is
needed. GitHub links open in Capsule's Browser.

The list is cached, because GitHub allows a limited number of anonymous
requests per hour for your whole machine. If a refresh fails, Capsule keeps
showing the last catalog it loaded and says why it could not update, rather
than showing you an empty page. The refresh button beside the tabs forces a
new fetch. If the saved catalog is damaged, Capsule discards it and fetches
it again; installed skills are unaffected.

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

Installing fetches the skill's `SKILL.md` and stores it with the skill. If that
text cannot be read, Capsule does not install it: a skill without its procedure
would attach to a conversation and do nothing.

**Install and attach** waits until the instructions have been saved before
adding the skill to your message. A failed install or removal keeps the detail
open with an error you can retry. A skill with the same name from a different
repository is a separate skill.

## From another device

A paired device sees the same Installed list and detail, and can attach a
skill to its own message. Browsing the catalog, installing and uninstalling
happen on the computer running Capsule.
