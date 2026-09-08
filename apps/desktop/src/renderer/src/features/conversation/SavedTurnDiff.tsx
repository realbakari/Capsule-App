import { useEffect, useMemo, useState } from "react";
import { parseUnifiedDiff } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { PagedFileDiffs } from "../shell/PagedFileDiffs";

/** One bounded patch, retained only while this turn's diff is open. */
export function SavedTurnDiff({ runId, path, initialPatch }: { runId: string; path?: string; initialPatch?: string }) {
  const { api } = useWorkspace();
  const key = JSON.stringify([runId, path, initialPatch]);
  const [result, setResult] = useState<{ key: string; patch?: string; truncated?: boolean; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setResult(undefined);
    if (initialPatch) { setResult({ key, patch: initialPatch }); return; }
    void api.turnDiff(runId, { relative: path }).then((value) => {
      if (!disposed) setResult({ key, patch: value.patch, truncated: value.patchTruncated });
    }, (error) => { if (!disposed) setResult({ key, error: formatUserError(error) }); });
    return () => { disposed = true; };
  }, [api, runId, path, key, initialPatch, retry]);
  const current = result?.key === key ? result : undefined;
  const files = useMemo(() => parseUnifiedDiff(current?.patch ?? "").filter((file) => !path || file.path === path || file.oldPath === path), [current?.patch, path]);
  if (!current) return <p role="status" className="faint">Loading saved changes…</p>;
  if (current.error) return <p role="alert">{current.error} <button type="button" className="ghost" onClick={() => setRetry((value) => value + 1)}>Retry diff</button></p>;
  return <>
    {current.truncated && <p className="faint" role="status">Preview limited to 512 KB. {path ? "Inspect the saved checkpoint in Git for the complete change." : "Select a file in the list above to load its own preview."}</p>}
    {files.length ? <PagedFileDiffs files={files} split={false} /> : <p className="faint">No text diff in this preview.</p>}
  </>;
}
