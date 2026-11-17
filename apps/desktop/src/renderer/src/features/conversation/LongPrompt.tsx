import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** About eight lines of a prompt: what a folded prompt shows. */
const FOLD_REM = 11;

/**
 * Fold only when the fold hides at least as much as it shows. A prompt one
 * line past the fold gained a control and a fade to hide that one line, and
 * opening it barely changed what was on screen.
 */
export function shouldFoldPrompt(contentHeight: number, foldedHeight: number): boolean {
  return foldedHeight > 0 && contentHeight >= foldedHeight * 2;
}

/**
 * A long prompt (a pasted log, a spec) folds to its first lines with a fade,
 * so the reply under it stays on screen. The measure runs on layout and on
 * resize; a prompt that fits never shows the control.
 */
export function LongPrompt({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return undefined;
    const measure = () => {
      const limit = FOLD_REM * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
      // The bubble's own scrollHeight is its full height even while clipped.
      const content = node.firstElementChild ?? node;
      setTall(shouldFoldPrompt(content.scrollHeight, limit));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node.firstElementChild ?? node);
    return () => observer.disconnect();
  }, []);
  const folded = tall && !open;
  // Find asks a fold to open when its selected match is in the hidden part.
  useEffect(() => {
    const node = frame.current;
    const reveal = () => setOpen(true);
    node?.addEventListener("beforematch", reveal);
    return () => node?.removeEventListener("beforematch", reveal);
  }, []);
  return (
    <div ref={frame} className={`long-prompt${folded ? " folded" : ""}`} data-thread-find-fold={folded ? "" : undefined}>
      <div ref={box} className="long-prompt-body">{children}</div>
      {tall && (
        <button type="button" className="long-prompt-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}
