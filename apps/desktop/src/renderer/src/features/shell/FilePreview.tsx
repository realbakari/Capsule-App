import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { lineRange, type FilePreview, type SharedSelection } from "@capsule/shared";
import { lineSpan, rangeForLine } from "../../lib/line-target";
import { showNativeContextMenu } from "../../lib/bridge";
import { registerSelectionReader, selectionContext, touchSelectionSurface } from "../../lib/selection-share";
import { useWorkspace } from "../../lib/workspace";

export function FilePreviewView({
  doc,
  line,
  editing,
  contents,
  saveState,
  onChange,
  onMention,
  onOpen,
  onEdit,
  onView,
  onReload,
  onOverwrite,
  onRetry,
  onCopy,
  openIn,
}: {
  doc: FilePreview;
  /** A line to bring into view and mark, from a `file:42` reference in the transcript. */
  line?: { line: number };
  editing: boolean;
  contents: string;
  saveState: "idle" | "pending" | "saving" | "saved" | "error" | "truncated" | "conflict";
  onChange: (value: string) => void;
  onMention: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onView: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
  /** Opens the file in another app; absent where there is no machine to open it on. */
  openIn?: ReactNode;
}) {
  const canEdit = doc.kind === "text" && !doc.truncated && Boolean(doc.revision);
  const { api, attachContext } = useWorkspace();
  const code = useRef<HTMLElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  /* The palette takes focus when it opens, which clears a selection in the
     preview; the last one made here is kept until another replaces it. */
  const lastSelection = useRef<SharedSelection | undefined>(undefined);
  const text = editing ? contents : doc.contents ?? contents;
  const [band, setBand] = useState<{ top: number; height: number; for: object }>();
  const bandRef = useRef<HTMLSpanElement>(null);
  const scrolledFor = useRef<object | undefined>(undefined);

  /* The band is measured from the rendered line, so a wrapped line is marked whole. */
  useLayoutEffect(() => {
    const host = code.current;
    const pre = host?.parentElement;
    if (!line || editing || doc.kind !== "text" || !host || !pre) { setBand(undefined); return undefined; }
    const measure = () => {
      const range = rangeForLine(host, line.line);
      if (!range) { setBand(undefined); return; }
      const rects = Array.from(range.getClientRects());
      const box = rects.length ? { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) } : range.getBoundingClientRect();
      const frame = pre.getBoundingClientRect();
      const height = Math.max(box.bottom - box.top, parseFloat(getComputedStyle(pre).lineHeight) || 0);
      setBand({ top: box.top - frame.top + pre.scrollTop, height, for: line });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [line, editing, doc.kind, doc.path, text]);

  /* Scrolled once per request, so reading on from the line is not pulled back to it. */
  useEffect(() => {
    // The band from the previous request is still drawn for one commit; wait for this one's.
    if (!band || !line || band.for !== line || scrolledFor.current === line) return;
    scrolledFor.current = line;
    bandRef.current?.scrollIntoView({ block: "center" });
  }, [band, line]);

  function readSelection(): SharedSelection | undefined {
    const at = (selected: string, start: number) => selected.trim()
      ? { origin: "file" as const, text: selected, path: doc.path, ...(doc.language ? { language: doc.language } : {}), ...lineRange(text, start, start + selected.length) }
      : undefined;
    if (editing && area.current) {
      const { selectionStart, selectionEnd } = area.current;
      return selectionEnd > selectionStart ? at(text.slice(selectionStart, selectionEnd), selectionStart) : undefined;
    }
    const selection = window.getSelection();
    const host = code.current;
    if (!selection || selection.isCollapsed || !host || !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) return undefined;
    const range = selection.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(host);
    before.setEnd(range.startContainer, range.startOffset);
    return at(range.toString(), before.toString().length);
  }

  useEffect(() => {
    lastSelection.current = undefined;
    if (doc.kind !== "text" || api.isDesktop !== true) return;
    const remember = () => {
      const current = readSelection();
      if (current) lastSelection.current = current;
      else if (document.activeElement === area.current || code.current?.contains(window.getSelection()?.anchorNode ?? null)) lastSelection.current = undefined;
    };
    document.addEventListener("selectionchange", remember);
    const unregister = registerSelectionReader("file", () => readSelection() ?? lastSelection.current);
    return () => { document.removeEventListener("selectionchange", remember); unregister(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, doc.kind, editing, text, api.isDesktop]);

  async function selectionMenu(event: { preventDefault(): void; clientX: number; clientY: number }) {
    const selection = readSelection();
    if (!selection || api.isDesktop !== true) return;
    event.preventDefault();
    const picked = await showNativeContextMenu([
      { id: "copy", label: "Copy" },
      { id: "send", label: "Send selection to thread" },
    ], { x: event.clientX, y: event.clientY });
    if (picked === "copy") void navigator.clipboard.writeText(selection.text);
    if (picked === "send") void attachContext(selectionContext(selection));
  }

  return (
    <div className="file-preview" onPointerDown={() => touchSelectionSurface("file")}>
      <div className="file-preview-bar">
        <span className="truncate mono" title={doc.path}>
          {doc.path}
        </span>
        <span className="meta">
          {doc.kind === "image" ? doc.mime : doc.language || doc.kind}
        </span>
        <button type="button" className="ghost" onClick={onMention}>
          Mention
        </button>
        <button type="button" className="ghost" onClick={onOpen}>
          Open
        </button>
        {openIn}
        {canEdit ? (
          editing ? (
            <button type="button" className="ghost" onClick={onView}>
              Preview
            </button>
          ) : (
            <button type="button" className="ghost" onClick={onEdit}>
              Edit
            </button>
          )
        ) : null}
        {saveState !== "idle" ? (
          <span className={`save-state ${saveState}`}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : saveState === "pending" ? "Unsaved" : ""}
          </span>
        ) : null}
      </div>
      {doc.truncated && doc.kind === "text" ? (
        <div className="faint file-editor-note">Showing the first part of a large file.</div>
      ) : null}
      {line && doc.kind === "text" && !lineSpan(text, line.line) ? (
        <div className="faint file-editor-note">
          {doc.truncated ? `Line ${line.line} is past the part shown here.` : `Line ${line.line} is past the end of this file.`}
        </div>
      ) : null}
      {(saveState === "conflict" || saveState === "error") ? (
        <div className="file-conflict">
          <span>{saveState === "conflict" ? "This file changed on disk since you opened it." : "The file could not be saved."} Your draft is retained until the app closes.</span>
          <span className="actions">
            <button className="chip" onClick={onReload}>
              Discard mine, reload
            </button>
            <button className="chip" onClick={onCopy}>Copy draft</button>
            {saveState === "error" && <button className="chip" onClick={onRetry}>Retry save</button>}
            {saveState === "conflict" && <button className="danger" onClick={onOverwrite}>
              Keep mine, overwrite
            </button>}
          </span>
        </div>
      ) : null}
      {doc.kind === "image" && doc.dataUrl ? (
        <ImagePreview key={doc.path} src={doc.dataUrl} name={doc.path} />
      ) : null}
      {doc.kind === "text" && editing ? (
        <textarea
          ref={area}
          onContextMenu={(event) => void selectionMenu(event)}
          className="mono file-editor-area"
          spellCheck={false}
          value={contents}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      {doc.kind === "text" && !editing ? (
        <pre className="mono file-preview-code" onContextMenu={(event) => void selectionMenu(event)}>
          {band && line ? <span ref={bandRef} className="file-preview-line" style={{ top: band.top, height: band.height }} data-line={line.line} aria-hidden /> : null}
          <code ref={code}><CodeLines text={doc.contents ?? contents} language={doc.language} target={line?.line} /></code>
        </pre>
      ) : null}
      {doc.kind === "binary" ? (
        <p className="faint">{doc.detail ?? "This file can’t be previewed here."}</p>
      ) : null}
    </div>
  );
}
import { CodeLines } from "./CodeLines";
import { ImagePreview } from "./ImagePreview";
