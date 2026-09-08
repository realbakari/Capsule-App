import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import type { TouchedFile } from "../../lib/activity";
import { highlight } from "../../lib/highlight";
import { savedDiffPreview } from "../../lib/saved-diff-preview";
import { formatUserError } from "../../lib/errors";

export type SavedPatchReader = (path: string) => Promise<{ patch: string; patchTruncated?: boolean }>;

/** One ephemeral preview per file list. No filesystem reads or retained cache. */
export function useSavedDiffPreview(patch: string | undefined, onOpenDiff?: (path?: string) => void, loadPatch?: SavedPatchReader) {
  const id = useId();
  const [active, setActive] = useState<{ file: TouchedFile; anchor: HTMLElement; patch?: string; reader?: SavedPatchReader }>();
  const [loaded, setLoaded] = useState<{ owner: typeof active; patch?: string; truncated?: boolean; error?: string }>();
  const [retry, setRetry] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressedFocus = useRef<HTMLElement | undefined>(undefined);
  const cancelTimer = () => { clearTimeout(timer.current); };
  const close = () => { cancelTimer(); setActive(undefined); };
  const leave = () => { cancelTimer(); timer.current = setTimeout(() => setActive(undefined), 180); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // An owner change cannot carry a preview into the next turn's snapshot.
  const shown = active?.patch === patch && active?.reader === loadPatch ? active : undefined;
  useEffect(() => {
    if (!shown || shown.patch || !shown.reader) return;
    let disposed = false;
    setLoaded(undefined);
    void shown.reader(shown.file.path).then((result) => {
      if (!disposed) setLoaded({ owner: shown, patch: result.patch, truncated: result.patchTruncated });
    }, (error) => { if (!disposed) setLoaded({ owner: shown, error: formatUserError(error) }); });
    return () => { disposed = true; };
  }, [shown, retry]);
  const result = loaded?.owner === shown ? loaded : undefined;
  const text = shown?.patch || result?.patch;
  const loading = Boolean(shown?.reader && !shown.patch && !result);
  const content = useMemo(() => shown && text ? savedDiffPreview(text, shown.file.path) : undefined, [shown, text]);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 440, width: 720 });

  useLayoutEffect(() => {
    if (!shown || !panel.current) return;
    const place = () => {
      const rect = shown.anchor.getBoundingClientRect();
      const above = rect.top - 20;
      const below = window.innerHeight - rect.bottom - 20;
      const up = above >= 220 || above >= below;
      const maxHeight = Math.max(100, Math.min(440, up ? above : below, window.innerHeight - 24));
      const width = Math.min(720, window.innerWidth - 24);
      const height = Math.min(panel.current?.getBoundingClientRect().height ?? maxHeight, maxHeight);
      setPosition({ width, maxHeight, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(up ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12)) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    const dismiss = () => { clearTimeout(timer.current); setActive(undefined); };
    const scroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      // Focusing a file can scroll it into view after the preview mounts.
      // Keep that keyboard preview anchored instead of immediately losing it.
      const rect = shown.anchor.getBoundingClientRect();
      if (document.activeElement === shown.anchor && rect.bottom > 0 && rect.top < window.innerHeight) place();
      else dismiss();
    };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !shown.anchor.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const restoreFocus = panel.current?.contains(document.activeElement);
      suppressedFocus.current = shown.anchor;
      dismiss();
      if (restoreFocus) shown.anchor.focus();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [shown]);

  const triggerProps = (file: TouchedFile): HTMLAttributes<HTMLElement> => {
    if ((!patch && !loadPatch) || !onOpenDiff) return {};
    const open = (anchor: HTMLElement, delay: number) => {
      cancelTimer();
      timer.current = setTimeout(() => {
        if (anchor.isConnected) setActive({ file, anchor, patch, reader: loadPatch });
      }, delay);
    };
    return {
      "aria-haspopup": "dialog",
      "aria-expanded": shown?.file.path === file.path,
      "aria-controls": shown?.file.path === file.path ? id : undefined,
      onPointerEnter: (event) => { if (event.pointerType !== "touch") open(event.currentTarget, 280); },
      onPointerLeave: leave,
      onFocus: (event) => { if (suppressedFocus.current !== event.currentTarget) open(event.currentTarget, 0); },
      onBlur: (event) => {
        suppressedFocus.current = undefined;
        if (!panel.current?.contains(event.relatedTarget as Node)) leave();
      },
      onKeyDown: (event) => {
        if (event.key === "ArrowDown" && shown?.file.path === file.path) {
          event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      },
    };
  };

  const preview = shown && createPortal(
    <div ref={panel} id={id} role="dialog" aria-modal="false" aria-label={`Saved changes to ${shown.file.path}`}
      className="saved-diff-preview" style={position}
      onPointerEnter={cancelTimer} onPointerLeave={leave} onFocus={cancelTimer}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== shown.anchor) leave(); }}>
      <header className="saved-diff-preview-head">
        <span className="saved-diff-preview-path" title={shown.file.path}>{shown.file.path}</span>
        {typeof shown.file.added === "number" && <span className="diffstat"><span className="added">+{shown.file.added}</span><span className="removed">−{shown.file.removed ?? 0}</span></span>}
      </header>
      <div className="saved-diff-preview-code" tabIndex={0} aria-label="Saved diff excerpt">
        {loading ? <p role="status">Loading saved changes…</p>
          : result?.error ? <p role="alert">{result.error} <button type="button" className="ghost" onClick={() => setRetry((value) => value + 1)}>Retry preview</button></p>
          : !content ? <p>{result?.truncated ? "This file exceeds the preview limit. Inspect the saved checkpoint in Git for the complete change." : "No text diff is available for this file in this saved snapshot."}</p>
          : content.file.binary ? <p>Binary file changed. There is no text preview.</p>
          : content.file.hunks.length === 0 ? <p>{content.truncated ? "Text is outside this excerpt. Open the file diff to inspect it." : content.file.status === "renamed" ? `Renamed from ${content.file.oldPath}. No text changes.` : "File metadata changed. No text changes."}</p>
          : content.file.hunks.map((hunk, index) => <Fragment key={index}>
            <div className="saved-diff-preview-hunk">{hunk.header}</div>
            {hunk.lines.map((line, row) => <div className={`saved-diff-preview-line ${line.kind}`} key={row}>
              <span className="preview-line-number">{line.oldLine ?? ""}</span><span className="preview-line-number">{line.newLine ?? ""}</span>
              <span className="preview-line-sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
              <code>{highlight(line.text, shown.file.path.split(".").pop())}</code>
            </div>)}
          </Fragment>)}
      </div>
      <footer className="saved-diff-preview-footer">
        <span>{content?.truncated || result?.truncated ? "Excerpt · saved at this turn" : "Saved at this turn"}</span>
        <button type="button" className="ghost" onClick={() => { close(); onOpenDiff?.(shown.file.path); }}>Open file diff</button>
      </footer>
    </div>, document.body,
  );
  return { triggerProps, preview, close };
}
