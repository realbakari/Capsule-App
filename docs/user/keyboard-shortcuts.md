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

`⌘/` opens a sheet listing every shortcut, including any you have changed. It is
also in the command palette as **Keyboard shortcuts**.

## Changing a shortcut

Settings → Shortcuts. Click a shortcut, press the keys you want, and it is
saved. **Reset** puts a single shortcut back; **Restore defaults** at the top of
the section puts all of them back.

Two things the editor will not let you do:

- **Take a shortcut another command already uses.** It tells you which command
  holds those keys instead of quietly reassigning them.
- **Change a shortcut marked as a menu item.** Those belong to the application
  menu, which receives the key before the window does, so changing them here
  would look like it worked and change nothing.

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
