import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ThreadMarkdownOptions } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { AlertTriangleIcon, CheckIcon } from "../shell/icons";
import { copyText } from "./copy-text";
import { ShareDialog } from "./ShareDialog";
import "./share.css";

/*
 * Export and share for a thread. One provider owns the dialogs and the result
 * toast, so the title menu, the sidebar row and the command palette open the
 * same thing and the outcome outlives whichever of them started it.
 */

interface ThreadShareValue {
  /** Saving a file needs the desktop's save dialog. */
  exportOffered: boolean;
  /** Creating a link needs the desktop: it is the host the link points at. */
  shareOffered: boolean;
  openExport: (sessionId: string) => void;
  copyMarkdown: (sessionId: string) => void;
  openShare: (sessionId: string) => void;
}

const ThreadShareContext = createContext<ThreadShareValue>({
  exportOffered: false, shareOffered: false, openExport: () => undefined, copyMarkdown: () => undefined, openShare: () => undefined,
});

export function useThreadShare(): ThreadShareValue {
  return useContext(ThreadShareContext);
}

type Toast = { kind: "done"; text: string } | { kind: "failed"; text: string };

const OPTIONS_KEY = "capsule.export.options";
const TOAST_MS = 6_000;

function storedOptions(): ThreadMarkdownOptions {
  try {
    const value = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Record<string, unknown>;
    return { includeToolActivity: value.includeToolActivity === true, includeChangedFiles: value.includeChangedFiles === true };
  } catch {
    return {};
  }
}

function storeOptions(options: ThreadMarkdownOptions): void {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* A preference, not state anyone relies on. */ }
}

export function ThreadShareProvider({ children }: { children: ReactNode }) {
  const { api } = useWorkspace();
  const desktop = api.isDesktop !== false;
  const [exporting, setExporting] = useState<string>();
  const [sharing, setSharing] = useState<string>();
  const [toast, setToast] = useState<Toast>();

  const copyMarkdown = useCallback((sessionId: string) => {
    void api.threadMarkdown(sessionId, storedOptions())
      .then((markdown) => copyText(markdown))
      .then(() => setToast({ kind: "done", text: "Copied the conversation as Markdown." }),
        (error) => setToast({ kind: "failed", text: `Could not copy: ${formatUserError(error)}` }));
  }, [api]);

  const value = useMemo<ThreadShareValue>(() => ({
    exportOffered: desktop,
    shareOffered: desktop,
    openExport: (sessionId) => setExporting(sessionId),
    copyMarkdown,
    openShare: (sessionId) => setSharing(sessionId),
  }), [desktop, copyMarkdown]);

  return (
    <ThreadShareContext.Provider value={value}>
      {children}
      {exporting && <ExportDialog sessionId={exporting} onClose={() => setExporting(undefined)} onDone={setToast} />}
      {sharing && <ShareDialog sessionId={sharing} onClose={() => setSharing(undefined)} />}
      <ShareToast toast={toast} onClose={() => setToast(undefined)} />
    </ThreadShareContext.Provider>
  );
}

function ShareToast({ toast, onClose }: { toast?: Toast; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!toast || toast.kind === "failed") return undefined;
    const timer = setTimeout(() => close.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`share-toast${toast.kind === "failed" ? " error" : ""}`} role={toast.kind === "failed" ? "alert" : "status"}>
      {toast.kind === "failed" ? <AlertTriangleIcon size={14} /> : <CheckIcon size={14} />}
      <span>{toast.text}</span>
      <button type="button" className="ghost" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}

function ExportDialog({ sessionId, onClose, onDone }: { sessionId: string; onClose: () => void; onDone: (toast: Toast) => void }) {
  const { api, sessions } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState(storedOptions);
  const [busy, setBusy] = useState<"save" | "copy">();
  const [error, setError] = useState<string>();
  useModalFocus(dialog, true, onClose, "[data-primary]");
  const title = sessions.find((item) => item.id === sessionId)?.title ?? "this conversation";

  const change = (patch: ThreadMarkdownOptions) => setOptions((current) => {
    const next = { ...current, ...patch };
    storeOptions(next);
    return next;
  });

  const run = (action: "save" | "copy") => {
    setBusy(action);
    setError(undefined);
    const work = action === "save"
      ? api.exportThreadMarkdown(sessionId, options).then((result) => {
        if (!result.saved) return;
        onDone({ kind: "done", text: `Exported to ${result.path?.split(/[\\/]/u).pop() ?? "a Markdown file"}.` });
        onClose();
      })
      : api.threadMarkdown(sessionId, options).then(copyText).then(() => {
        onDone({ kind: "done", text: "Copied the conversation as Markdown." });
        onClose();
      });
    void work.catch((failure: unknown) => setError(formatUserError(failure))).finally(() => setBusy(undefined));
  };

  return (
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog share-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="export-title">Export as Markdown</h3>
        <p className="share-dialog-lede">Prompts, replies and attachment names from <b>{title}</b>. Attached files are named, not located.</p>
        <fieldset className="share-options">
          <legend className="sr-only">Include</legend>
          <label className="share-option">
            <input type="checkbox" checked={options.includeToolActivity === true} onChange={(event) => change({ includeToolActivity: event.target.checked })} />
            <span><b>Tool activity</b><small>Each turn's tool calls, folded under a summary line.</small></span>
          </label>
          <label className="share-option">
            <input type="checkbox" checked={options.includeChangedFiles === true} onChange={(event) => change({ includeChangedFiles: event.target.checked })} />
            <span><b>Changed files</b><small>The files each turn changed, with line counts.</small></span>
          </label>
        </fieldset>
        {error && <p className="share-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => run("copy")}>{busy === "copy" ? "Copying…" : "Copy"}</button>
          <button type="button" className="send" data-primary disabled={Boolean(busy)} onClick={() => run("save")}>{busy === "save" ? "Exporting…" : "Save as…"}</button>
        </div>
      </div>
    </div>
  );
}
