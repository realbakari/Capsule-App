import { useEffect, useState, type RefObject } from "react";
import { quoteMarkdown } from "../../lib/quote";
import { insertBlock } from "../../lib/terminal-selection";
import { useWorkspace } from "../../lib/workspace";
import "./quote-selection.css";

interface Picked { text: string; top: number; left: number }

/** The selection, when it lies inside a single reply in this transcript. */
function readSelection(root: HTMLElement): Picked | undefined {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const reply = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest(".msg.assistant");
  const start = reply(selection.anchorNode);
  if (!start || start !== reply(selection.focusNode) || !root.contains(start)) return undefined;
  const text = selection.toString().trim();
  if (!text) return undefined;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return { text, top: rect.top, left: rect.left + rect.width / 2 };
}

/**
 * Select part of a reply and Quote puts it in the composer as a Markdown
 * quote at the caret, ready for "why this?". Only inside one reply: a
 * selection across turns is reading, not quoting.
 */
export function QuoteSelection({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
  const { setDraft } = useWorkspace();
  const [picked, setPicked] = useState<Picked>();

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPicked(readSelection(root)));
    };
    const clear = () => setPicked(undefined);
    document.addEventListener("selectionchange", update);
    root.addEventListener("scroll", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      root.removeEventListener("scroll", clear);
    };
  }, [scroller]);

  if (!picked) return null;
  const quote = () => {
    const field = document.querySelector<HTMLTextAreaElement>("textarea.composer-field");
    let caret = 0;
    setDraft((current) => {
      const placed = field && field.value === current && (field.selectionEnd > 0 || document.activeElement === field);
      const next = insertBlock(current, placed ? field.selectionEnd : current.length, quoteMarkdown(picked.text));
      caret = next.caret;
      return next.draft;
    });
    document.getSelection()?.removeAllRanges();
    setPicked(undefined);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!field?.isConnected) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    }));
  };
  return (
    <button
      type="button"
      className="quote-selection"
      style={{ top: Math.max(8, picked.top - 40), left: picked.left }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={quote}
    >
      Quote in reply
    </button>
  );
}
