import type { IDisposable, Terminal } from "@xterm/xterm";

import { bufferRange, findTerminalLinks, logicalLine, terminalLinkHint, type TerminalLinkContext, type TerminalLinkTarget } from "../../lib/terminal-links";

export interface TerminalLinkHandlers {
  context: () => TerminalLinkContext;
  /** ⌘ on macOS, Ctrl elsewhere: the key that sends a link out of Capsule. */
  modifier: { label: string; held: (event: MouseEvent) => boolean };
  open: (target: TerminalLinkTarget, outside: boolean) => void;
  hover: (hint: { text: string; x: number; y: number } | undefined) => void;
}

/**
 * Links in one terminal: found per logical line so a wrapped URL is one link,
 * underlined on hover, explained in a hint, and opened on click.
 */
export function registerTerminalLinks(terminal: Terminal, handlers: TerminalLinkHandlers): IDisposable {
  return terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const buffer = terminal.buffer.active;
      const line = logicalLine((row) => buffer.getLine(row), bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const links = findTerminalLinks(line.text, handlers.context()).flatMap((link) => {
        const range = bufferRange(line, link.start, link.end);
        if (!range || range.start.y > bufferLineNumber || range.end.y < bufferLineNumber) return [];
        return [{
          range,
          text: link.text,
          decorations: { underline: true, pointerCursor: link.target.kind !== "external" },
          activate: (event: MouseEvent) => {
            // A drag that starts and ends on a link is a selection, not a click.
            if (terminal.hasSelection()) return;
            const outside = handlers.modifier.held(event);
            if (link.target.kind === "external" && !outside) return;
            handlers.hover(undefined);
            handlers.open(link.target, outside);
          },
          hover: (event: MouseEvent) => handlers.hover({ text: terminalLinkHint(link.target, handlers.modifier.label), x: event.clientX, y: event.clientY }),
          leave: () => handlers.hover(undefined),
        }];
      });
      callback(links.length ? links : undefined);
    },
  });
}
