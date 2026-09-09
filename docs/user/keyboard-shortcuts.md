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
| Toggle the inspector | `⌘\` |
| Stash the current prompt | `⌘S` |
| Send | `Enter`, or `⌘Enter` if you changed the send key |

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

## Finding your way around

The command palette groups recent conversations, actions, projects, and matching
messages. File search shows names with their paths and searches the current
conversation's checkout, including a worktree. Loading and failed searches are
labelled separately from no matches; failed searches offer **Retry**.

Use the arrow keys to move through results, `Home` / `End` for the first or last
result, `Enter` to select, and `Esc` to close. The selected result stays in view.
Actions that need the desktop app explain that in a paired viewer.

Searching the sidebar by project name keeps that project's conversations visible.
Hiding the sidebar removes its controls from keyboard navigation; showing it
restores them.
