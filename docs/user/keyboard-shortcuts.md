# Keyboard shortcuts

Keys are written the macOS way. On Windows and Linux, read `⌘` as `Ctrl`, `⌥`
as `Alt` and `⇧` as `Shift`; Settings, the shortcuts sheet, the command palette
and tooltips show your own platform's names.

| Action | Keys |
|--------|------|
| Settings | `⌘,` |
| Command palette | `⌘K` |
| New conversation | `⌘N` |
| Open or attach a folder | `⌘O` |
| Open the conversation's folder in your favourite app | `⌥⌘O` |
| Mention files from disk | `⇧⌘O` |
| Search files to mention | `⌘P` |
| Search in files | `⇧⌘F` |
| Toggle the sidebar | `⌘B` |
| Toggle the side panel | `⌘\` |
| Reopen the side panel you closed, on the same surface | `⇧⌘T` |
| Find in the current conversation | `⌘F` (in the browser panel: find on the page; in the Files tree: search files) |
| Next or previous match in find | `Enter` / `⇧Enter` |
| Open a reply link in your system browser | `⌥`-click the link |
| Jump to an earlier prompt in this conversation | `⇧⌘J` |
| Previous or next turn: scroll to the prompt before or after the one you are reading | `⌥⌘↑` / `⌥⌘↓` |
| Move between turns from the ticks at the conversation's left edge | `↑` / `↓`, `Home` / `End`, then `Enter` |
| Back to the previous conversation you visited | `⌘[` |
| Forward again | `⌘]` |
| Stash the current prompt | `⌘S` |
| Undo the latest archive, settle or snooze while its notice is visible | `⌘Z` / `Ctrl+Z`, outside an editor or dialog |
| Settle this conversation and go to the next one waiting for you | `⌘E` |
| Mark this conversation unread | `⇧⌘U` |
| Send | `Enter`, or `⌘Enter` if you changed the send key |
| Stop the running turn | `⌘.` from anywhere, `Esc` in the composer, or **Stop the running turn** in the command palette |
| Put the caret in the composer | `⇧Esc` |
| Take the last queued follow-up back to edit | `⌥↑` in an empty composer |
| Move focus to the next region (sidebar, conversation, composer, side panel) | `F6`, or `⇧F6` to go back |
| Show every shortcut | `⌘/` |
| Add the terminal selection to the message | `⌘L` in the terminal (`Ctrl+Shift+L` on Windows and Linux) |
| Open a terminal link in your default browser | `⌘`-click |
| Open Review; press again on Review to close the panel | `⇧⌘D` |
| Open the Browser; press again to close the panel | `⇧⌘B` |
| Next conversation, by recent activity | `⌃Tab` (`Ctrl+Tab` everywhere) |
| Previous conversation | `⌃⇧Tab` |
| Choose the model | `⇧⌘M` |
| Choose permissions (Ask, Auto, Full) | `⇧⌘P` |
| Choose the reasoning effort | `⇧⌘E` |
| Pick one of the first nine models while the model panel is open | `⌘1` to `⌘9` |
| Next favorite model | `⌥⌘M` |
| Switch between Plan and Act | `⇧Tab` in the prompt |
| Start or finish dictation (macOS) | `⇧⌘L` |

`⌥⌘O` opens the folder the conversation works in, which is its worktree when it
has one, in the app you last chose from **Open in**. With no favourite yet, it
opens Conversation details with the list of apps showing. `⌘O` stays **Open
folder**.

The mode, model and effort shortcuts open the composer's own controls. When the
current agent has no such control, or it cannot change during a turn, a notice
says why.

`⌘/` opens a sheet listing every shortcut, including any you have changed and
any sequences. It is also in the command palette as **Keyboard shortcuts**.

On a Mac, `⌘` shortcuts answer only to `⌘`, so Control keeps its text editing
keys in the composer and other fields: `⌃A`, `⌃E`, `⌃F`, `⌃B`, `⌃P` and the
rest move the caret as they do everywhere else on macOS. On Windows and Linux,
a character typed with `AltGr` (such as `ó`, `@` or `€`) stays a character and
never sets off an `Alt` shortcut.

## Changing a shortcut

Your shortcuts live in `keybindings.json` in your settings folder
(`~/.capsule/keybindings.json`), so they can travel with your dotfiles.
Settings → Shortcuts reads and writes that file, and keeps any comments in it.

Shortcuts are grouped into **General**, **Go to**, **Conversation**,
**Composer** and **Workspace**, with any you added yourself under **Your
bindings**. Each row names the command, says what it does when the name is not
enough, and shows its keys on the right.

- Click a shortcut and press the keys you want. Press one key, or two in a row
  for a sequence such as `⌘G` then `⌘S`. `Esc` cancels.
- If the keys you pressed already run another command, the row says which and
  waits: **Use it here** moves the keys, **Keep both as they are** leaves
  everything alone. Keys the application menu owns are refused with the reason.
- **Unbind** leaves a command with no keys. **Reset** puts its default back,
  and appears on a row you changed, which is marked **Changed**.
- Search by name, or by keys as you would write or see them: `cmd+shift+d`,
  `⇧⌘D` or `Ctrl+Shift+D`. **Record keys to find** finds a shortcut by pressing
  it; the list keeps the shortcuts whose keys start with what you pressed.
- **Add a binding…** gives a key to a command of your own, a project action, or
  any shortcut, and lets you choose where it works.
- **Open keybindings.json** opens the file.

When two bindings get in each other's way, the rows involved say so under their
names: two commands on the same keys, or a key that fires before a sequence
starting with it can finish.

Shortcuts that belong to the application menu are fixed: `⌘K`, `⌘N`, `⌘O`,
`⇧⌘O`, `⌘,`, `⇧⌘N`, `⇧⌘S`, `⇧⌘R`, and the standard ones such as `⌘W`, `⌘Q`,
`⌘C` and `⌘Z`. On Windows and Linux the menu also owns `Ctrl+Shift+I`
(developer tools), `F11` (full screen) and `Ctrl+Y` (redo). The menu receives
those keys before the window does, so a binding that starts with one never
fires. Settings explains it on the row and Diagnostics names it.

In a paired browser, shortcuts are read only, and the browser may take some
keys, such as `⌘T` or `⌘W`, before Capsule sees them.

## keybindings.json

The file is a list of blocks. Each block says where its bindings work and maps
keys to actions:

```jsonc
[
  // Everywhere.
  {
    "context": "global",
    "bindings": {
      "cmd+g cmd+s": "toggle-sidebar",
      "cmd+p": null,
      "cmd+shift+r": "command:review",
      "ctrl+alt+d": "action:dev"
    }
  },
  // Only while typing in the composer.
  {
    "context": "composer",
    "bindings": { "ctrl+r": "command:review" }
  }
]
```

- **Keys.** Modifiers and a key joined by `+`: `cmd`, `ctrl`, `alt` (or
  `option`), `shift`. `cmd` is `⌘` on a Mac and Control elsewhere; `ctrl` is the
  Control key itself, which on Windows and Linux makes `cmd+k` and `ctrl+k` the
  same keys. Two chords separated by a space are a sequence; after the
  first, Capsule waits 1.5 seconds for the second and shows
  "… waiting for the next key" near the bottom of the window.
- **Actions.** A shortcut's id, such as `toggle-sidebar`, `search-files`,
  `toggle-terminal`, `open-review`, `previous-turn`, `next-turn`, `stop-turn`,
  `focus-composer` or `clear-backdrop`. `command:<name>` puts
  one of your commands in the composer, as picking it from the `/` menu does.
  `action:<name>` runs the open project's action of that name. `profile:<id>`
  is reserved for profiles, which are not available yet; Diagnostics says so.
- **null** removes whatever holds those keys in that context.
- **Contexts.** `global`, `composer`, `panel` (the side panel), `review`,
  `terminal` and `palette`. The surface you are in answers first, then
  `global`. A key without `⌘` or Control, pressed while typing, only reaches
  bindings in the composer and the other non-global contexts, so typing stays
  typing.

Binding an action replaces its default keys. Later entries win over earlier
ones. A line that does not parse is skipped and listed in Settings →
Diagnostics; the rest of the file still applies.

## In the composer

- `/` for commands: `/new`, `/init`, `/model`, `/plan`, `/compact`, `/stash`, saved prompts and skills
- `Esc` stops the running turn; with text in the prompt, Send queues it (or steers the turn) instead of stopping
- `@` to mention a file, or `@thread`, `@diff`, `@diagnostics` and `@url` to attach context
- `!` at the start of the prompt, then `Enter`, to run a command and attach its output
- `$` to attach a skill
- Paperclip or drop to attach local files
- `⌘S` to stash the current prompt, or open the stash when the composer is empty
- `↑` in an empty prompt recalls earlier prompts from this conversation; `↓` comes back
- `⇧Tab` switches the next turn between Plan and Act; while a suggestion menu is open, Tab picks from the menu instead
- `⇧⌘L` to dictate; `Enter` keeps the text and `Esc` cancels and restores the draft

## In Review

With a hunk's heading focused, `j` or `↓` moves to the next hunk and `↑` to the
previous one. `k` keeps the hunk, `u` unstages it and `x` rejects it. See
[Reviewing changes](./review.md).

## Finding your way around

Archiving a conversation offers **Undo** for ten seconds. After that, open
**History** and choose **Restore** on an archived conversation. Messages and the
agent's session identity are preserved. These actions are desktop-only.

Opened with nothing typed, the command palette lists what you can do right
now: your five most recently active conversations (with how long ago each
moved), then actions, actions on the open conversation, places to go, workspace
controls, profiles and the theme. Each group appears once. Commands that cannot
run here, such as **Fork conversation from last turn** with no conversation
open, stay out of this list; type their name and they appear with the reason.
Long lists (Review scopes, approval presets, settings files, plugins, agent
commands, browser sizes, projects) also wait until you type.

**New conversation in…** shows a chevron because it opens a second page. Go back
with the arrow beside the search field or `⌫` in an empty field. **New
conversation** names the project it will start in, and **Open folder** says
whether the folder becomes a new project or replaces the current project's
folder.

Start your search with `>` to search commands only, leaving out conversations,
projects and messages.

File search
shows names with their paths and searches the current conversation's checkout,
including a worktree. Loading and failed searches are labelled separately from
no matches; failed searches offer **Retry**.

You do not have to type a name in full. The letters you type only need to appear
in order, starting at the beginning of a word: `nc` finds **New conversation**
and `gtf` finds **Go to file…**. Matches at word starts and runs of consecutive
letters rank first, a shorter name wins a tie, and the matched letters are
underlined. When a command and a conversation match equally well, the command
comes first, so `new` then `Enter` starts a conversation. Conversations that
match equally well are ordered by recent activity, independently of sidebar
pins, and message-body matches come last. The palette keeps its size while you
type, and "Searching messages…" waits in its footer, so results do not jump
under the pointer.

Each command shows its current keys, including keys you changed in Settings, so
the palette doubles as a way to learn them.

**This conversation** appears while a conversation is open. It holds the same
actions as the conversation's menu (rename, pin, settle, snooze, mark unread,
copy as Markdown, generate a title, open its folder, archive, delete) plus:

- **Settle and go to next** (`⌘E`) settles it and opens whatever is waiting for
  you next.
- **Rename conversation** edits the name in place in the title bar.
- **Restart agent session** closes the conversation's coding agent and starts it
  again in the same conversation, with the same model, permissions and mode.
  It works for every coding agent, through the Gateway or directly. Going
  directly, the agent picks its own session back up when it supports resuming;
  otherwise it starts fresh. A conversation with no coding agent has nothing to
  restart, and the palette says so. A running turn is stopped first.

**Go to file…** opens file search and **Search in files…** opens search in
files. **New conversation in…** lists your projects: type to narrow, `Enter`
starts the conversation there, and `Backspace` in an empty field goes back.
**Light theme**, **Dark theme** and **Match system theme** switch the
appearance; the current one is marked.

Use the arrow keys to move through results, `Home` / `End` for the first or last
result, `Enter` to select, and `Esc` to close. The selected result stays in view.
Resizing or scrolling beneath a stationary mouse keeps your keyboard selection;
moving the pointer over another result highlights it.
Actions that need the desktop app explain that in a paired viewer.

Searching the sidebar by project name keeps that project's conversations visible.
Hiding the sidebar removes its controls from keyboard navigation; showing it
restores them.

## In the side panel

When the panel shows its list of surfaces, press a surface's letter to open it:
**R** Review, **B** Browser, **M** Simulator, **F** Files, **A** Agents,
**S** Side chat. Each card shows its letter.
