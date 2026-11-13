import { useEffect, useMemo, useState } from "react";
import { parseUnifiedDiff, type DiffFile } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { displayPrefs } from "../../lib/display-prefs";
import type { ReviewScope } from "../../lib/review-scope";
import { PagedFileDiffs } from "../shell/PagedFileDiffs";
import { useViewedFiles } from "./useViewedFiles";
import "./review.css";

/** `identity` is what is being compared; a refresh of the same identity keeps showing the last answer. */
type Loaded = { identity: string } & (
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unavailable" }
  | { status: "ready"; patch: string; files: DiffFile[]; truncated: boolean });

function ready(identity: string, patch: string, truncated: boolean, previous: Loaded): Loaded {
  // An unchanged patch keeps its parsed files, so folds and pages survive a refresh.
  if (previous.identity === identity && previous.status === "ready" && previous.patch === patch && previous.truncated === truncated) return previous;
  return { identity, status: "ready", patch, files: parseUnifiedDiff(patch), truncated };
}

/**
 * The diff Review shows for its scope: the working tree against HEAD, or what
 * one saved turn changed. Every file at once, paged and foldable, with
 * per-file "Viewed" marks kept for this thread.
 */
export function ReviewChanges({ scope, thread, sessionId, ignoreWhitespace, focusPath, onClearFocus, refreshKey }: {
  scope: ReviewScope;
  thread: string;
  sessionId?: string;
  ignoreWhitespace: boolean;
  /** One file of the working tree, chosen from the changed-file list. */
  focusPath?: string;
  onClearFocus: () => void;
  /** Changes whenever the working tree might have. */
  refreshKey: string;
}) {
  const { api, projectId } = useWorkspace();
  const viewed = useViewedFiles(thread);
  const [retry, setRetry] = useState(0);
  const relative = scope.kind === "uncommitted" ? focusPath : undefined;
  const identity = JSON.stringify([projectId, sessionId, scope, ignoreWhitespace, relative]);
  const reload = JSON.stringify([scope.kind === "uncommitted" ? refreshKey : "", retry]);
  const [loaded, setLoaded] = useState<Loaded>({ identity, status: "loading" });

  useEffect(() => {
    if (!projectId) return undefined;
    let disposed = false;
    setLoaded((previous) => previous.identity === identity && previous.status === "ready" ? previous : { identity, status: "loading" });
    const read: Promise<(previous: Loaded) => Loaded> = scope.kind === "turn"
      ? api.turnDiff(scope.runId, { ignoreWhitespace }).then((result) => (previous) => result.available === false
        ? { identity, status: "unavailable" }
        : ready(identity, result.patch, Boolean(result.patchTruncated), previous))
      : api.gitDiff(projectId, relative, sessionId, { ignoreWhitespace }).then((patch) => (previous) =>
        ready(identity, String(patch ?? ""), false, previous));
    void read.then(
      (update) => { if (!disposed) setLoaded(update); },
      (error: unknown) => { if (!disposed) setLoaded({ identity, status: "error", message: formatUserError(error) }); },
    );
    return () => { disposed = true; };
  }, [api, projectId, sessionId, scope, ignoreWhitespace, relative, identity, reload]);

  const current: Loaded = loaded.identity === identity ? loaded : { identity, status: "loading" };
  const split = displayPrefs().diffLayout === "split";
  const files = useMemo(() => current.status === "ready" ? current.files : [], [current]);

  return <section className="review-changes" aria-busy={current.status === "loading"}>
    {focusPath && scope.kind === "uncommitted" ? (
      <div className="review-changes-focus">
        <span className="faint">Showing</span>
        <span className="mono truncate" title={focusPath}>{focusPath}</span>
        <button type="button" className="chip" onClick={onClearFocus}>All files</button>
      </div>
    ) : null}
    {current.status === "loading" ? (
      <p className="review-changes-note faint" role="status">Loading changes…</p>
    ) : current.status === "error" ? (
      <div className="review-changes-note review-changes-error" role="alert">
        <span>{current.message}</span>
        <button type="button" className="chip" onClick={() => setRetry((value) => value + 1)}>Retry</button>
      </div>
    ) : current.status === "unavailable" ? (
      <p className="review-changes-note faint">
        This turn has no earlier checkpoint to compare against, so its changes cannot be told apart from what came before it.
      </p>
    ) : files.length === 0 ? (
      <p className="review-changes-note faint">
        {scope.kind === "turn"
          ? ignoreWhitespace ? "This turn changed nothing besides whitespace." : "This turn changed no files."
          : ignoreWhitespace ? "No changes besides whitespace." : "No uncommitted changes."}
      </p>
    ) : (
      <>
        {current.truncated ? (
          <p className="review-changes-note faint" role="status">Preview limited to 512 KB. Later files are left out.</p>
        ) : null}
        <PagedFileDiffs files={files} split={split} viewed={viewed} />
      </>
    )}
  </section>;
}
