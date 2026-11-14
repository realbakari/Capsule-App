# Keyboard shortcuts

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
| Find in the current conversation | `⌘F` (in the browser panel: find on the page) |
| Back to the previous conversation you visited | `⌘[` |
| Forward again | `⌘]` |
| Stash the current prompt | `⌘S` |
| Undo the latest archive, settle or snooze while its notice is visible | `⌘Z` / `Ctrl+Z`, outside an editor or dialog |
| Settle this conversation and go to the next one waiting for you | `⌘E` |
| Mark this conversation unread | `⇧⌘U` |
| Send | `Enter`, or `⌘Enter` if you changed the send key |
| Stop the running turn | `Esc` in the composer |
| Take the last queued follow-up back to edit | `⌥↑` in an empty composer |
| Move focus to the next region (sidebar, conversation, composer, side panel) | `F6`, or `⇧F6` to go back |
| Show every shortcut | `⌘/` |
| Add the terminal selection to the message | `⌘L` in the terminal (`Ctrl+Shift+L` on Windows and Linux) |
| Open a terminal link in your default browser | `⌘`-click |
| Open Review | `⇧⌘D` |
| Open the Browser | `⇧⌘B` |
| Next conversation, by recent activity | `⌃Tab` |
| Previous conversation | `⌃⇧Tab` |
| Choose the mode (permissions) | `⇧⌘M` |
| Choose the model | `⇧⌘I` |
| Choose the reasoning effort | `⇧⌘E` |
| Start or finish dictation (macOS) | `⇧⌘L` |

`⌥⌘O` opens the folder the conversation works in, which is its worktree when it
has one, in the app you last chose from **Open in**. With no favourite yet, it
opens Conversation details with the list of apps showing. `⌘O` stays **Open
folder**.

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
- `⇧⌘L` to dictate; `Enter` keeps the text and `Esc` cancels and restores the draft

## Finding your way around

Archiving a conversation offers **Undo** for ten seconds. After that, open
**History** and choose **Restore** on an archived conversation. Messages and the
agent's session identity are preserved. These actions are desktop-only.

The command palette groups recent conversations, actions on the open
conversation, actions, the theme, projects, and matching messages. File search
shows names with their paths and searches the current conversation's checkout,
including a worktree. Loading and failed searches are labelled separately from
no matches; failed searches offer **Retry**.

You do not have to type a name in full. The letters you type only need to appear
in order, starting at the beginning of a word: `nc` finds **New conversation**
and `gtf` finds **Go to file…**. Matches at word starts and runs of consecutive
letters rank first, a shorter name wins a tie, and the matched letters are
underlined. Conversations that match equally well are ordered by recent activity,
independently of sidebar pins, and message-body matches come last. With no
query, the palette shows your five most recently active conversations. The
palette keeps its size while you type, so results do not jump under the pointer.

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
