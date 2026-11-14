# Keyboard shortcuts

| Action | Keys |
|--------|------|
| Settings | `⌘,` |
| Command palette | `⌘K` |
| New conversation | `⌘N` |
| Open or attach a folder | `⌘O` |
| Mention files from disk | `⇧⌘O` |
| Search files to mention | `⌘P` |
| Search in files | `⇧⌘F` |
| Toggle the sidebar | `⌘B` |
| Toggle the side panel | `⌘\` |
| Find in the current conversation | `⌘F` |
| Back to the previous conversation you visited | `⌘[` |
| Forward again | `⌘]` |
| Stash the current prompt | `⌘S` |
| Undo the latest archive while its notice is visible | `⌘Z` / `Ctrl+Z`, outside an editor or dialog |
| Send | `Enter`, or `⌘Enter` if you changed the send key |
| Stop the running turn | `Esc` in the composer |
| Show every shortcut | `⌘/` |
| Open Review | `⇧⌘D` |
| Open the Browser | `⇧⌘B` |
| Next conversation, by recent activity | `⌃Tab` |
| Previous conversation | `⌃⇧Tab` |
| Choose the mode (permissions) | `⇧⌘M` |
| Choose the model | `⇧⌘I` |
| Choose the reasoning effort | `⇧⌘E` |

The mode, model and effort shortcuts open the composer's own controls. When the
current agent has no such control, or it cannot change during a turn, a notice
says why.

`⌘/` opens a sheet listing every shortcut, including any you have changed and
any sequences. It is also in the command palette as **Keyboard shortcuts**.

## Changing a shortcut

Your shortcuts live in `keybindings.json` in your settings folder
(`~/.capsule/keybindings.json`), so they can travel with your dotfiles.
Settings → Shortcuts reads and writes that file, and keeps any comments in it.

- Click a shortcut and press the keys you want. Press one key, or two in a row
  for a sequence such as `⌘G` then `⌘S`.
- **Unbind** leaves a command with no keys. **Reset** puts its default back.
- **Search by keys** finds a shortcut by pressing it. The list keeps the
  shortcuts whose keys start with what you pressed.
- **Add a binding…** gives a key to a command of your own, a project action, or
  any shortcut, and lets you choose where it works.
- **Open keybindings.json** opens the file.

When two bindings get in each other's way, the screen lists them under
**Conflicts**: a key that fires before a sequence starting with it can finish.

Shortcuts that belong to the application menu (`⌘K`, `⌘N`, `⌘O`, `⇧⌘O`, `⌘,`,
and the standard ones such as `⌘W`, `⌘Q` and `⌘C`) are fixed. The menu receives
those keys before the window does, so a binding that starts with one never
fires. Settings strikes it through and Diagnostics names it.

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
  Control key itself. Two chords separated by a space are a sequence; after the
  first, Capsule waits 1.5 seconds for the second and shows
  "… waiting for the next key" near the bottom of the window.
- **Actions.** A shortcut's id, such as `toggle-sidebar`, `search-files`,
  `toggle-terminal`, `open-review` or `clear-backdrop`. `command:<name>` puts
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

- `/` for commands
- `@` to mention a file
- `$` to attach a skill
- Paperclip or drop to attach local files
- `⌘S` to stash the current prompt, or open the stash when the composer is empty
- `↑` in an empty prompt recalls earlier prompts from this conversation; `↓` comes back

## Finding your way around

Archiving a conversation offers **Undo** for ten seconds. After that, open
**History** and choose **Restore** on an archived conversation. Messages and the
agent's session identity are preserved. These actions are desktop-only.

The command palette groups recent conversations, actions, projects, and matching
messages. File search shows names with their paths and searches the current
conversation's checkout, including a worktree. Loading and failed searches are
labelled separately from no matches; failed searches offer **Retry**.

An exact conversation-title match comes first. Other matching conversation titles
are ordered by recent activity, independently of sidebar pins, before message-body
matches. With no query, the palette shows your most recently active conversations.

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
