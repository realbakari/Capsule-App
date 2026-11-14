import { useEffect, useMemo, useState } from "react";
import { parseUnifiedDiff, rejectHunks, type DiffFile } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { PagedFileDiffs } from "../shell/PagedFileDiffs";
import { HunkTools, type HunkProgress } from "../review/HunkTools";

/** The most hunks one preview checks against the working tree. */
const CHECKED_HUNKS = 200;

type Slot = { file: DiffFile; index: number };

/*
 * Reject on a saved turn's hunks, offered only where it would still work: the
 * turn is the conversation's latest, and git agrees the hunk still applies in
 * reverse to the working tree. A hunk the user has edited since is left alone.
 */
function useTurnRejects(files: DiffFile[], enabled: boolean) {
  const { api, projectId, session, gitApplyHunk } = useWorkspace();
  const slots = useMemo<Slot[]>(() => files.flatMap((file) => file.binary ? [] : file.hunks.map((_, index) => ({ file, index }))).slice(0, CHECKED_HUNKS), [files]);
  const [applies, setApplies] = useState<{ slots: Slot[]; ok: Set<string> }>();
  const [progress, setProgress] = useState<Record<string, HunkProgress | "rejected">>({});
  const [recheck, setRecheck] = useState(0);
  const sessionId = session?.id;
  useEffect(() => {
    if (!enabled || !projectId || !slots.length) return;
    let current = true;
    void api.gitCheckHunks(projectId, slots.map((slot) => rejectHunks(slot.file, [slot.index])), sessionId).then((results) => {
      if (current) setApplies({ slots, ok: new Set(slots.flatMap((slot, i) => results[i] ? [`${slot.file.path}\0${slot.index}`] : [])) });
    }, () => { if (current) setApplies({ slots, ok: new Set() }); });
    return () => { current = false; };
  }, [api, enabled, projectId, sessionId, slots, recheck]);
  if (!enabled || applies?.slots !== slots) return undefined;
  return (file: DiffFile) => {
    const offered = file.hunks.some((_, index) => {
      const key = `${file.path}\0${index}`;
      return applies.ok.has(key) || progress[key];
    });
    if (!offered) return undefined;
    return {
      label: (index: number) => `Hunk ${index + 1} of ${file.hunks.length} in ${file.path}`,
      render: (index: number) => {
        const key = `${file.path}\0${index}`;
        const state = progress[key];
        if (state === "rejected") return <span className="hunk-tools"><span className="hunk-stage hunk-stage--partly">Rejected</span></span>;
        if (!applies.ok.has(key) && !state) return null;
        return <HunkTools actions={["reject"]} progress={state} onRetry={() => setRecheck((value) => value + 1)} onAct={() => {
          setProgress((value) => ({ ...value, [key]: { busy: "reject" } }));
          gitApplyHunk(rejectHunks(file, [index])).then(
            () => { setProgress((value) => ({ ...value, [key]: "rejected" })); setRecheck((value) => value + 1); },
            (error) => setProgress((value) => ({ ...value, [key]: { error: formatUserError(error) } })),
          );
        }} />;
      },
    };
  };
}

/** One bounded patch, retained only while this turn's diff is open. */
export function SavedTurnDiff({ runId, path, initialPatch, rejectable = false }: {
  runId: string;
  path?: string;
  initialPatch?: string;
  /** The turn is the conversation's latest, so its hunks may be rejected. */
  rejectable?: boolean;
}) {
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
  const hunkSlot = useTurnRejects(files, rejectable && api.isDesktop !== false && Boolean(current?.patch));
  if (!current) return <p role="status" className="faint">Loading saved changes…</p>;
  if (current.error) return <p role="alert">{current.error} <button type="button" className="ghost" onClick={() => setRetry((value) => value + 1)}>Retry diff</button></p>;
  return <>
    {current.truncated && <p className="faint" role="status">Preview limited to 512 KB. {path ? "Inspect the saved checkpoint in Git for the complete change." : "Select a file in the list above to load its own preview."}</p>}
    {files.length ? <PagedFileDiffs files={files} split={false} hunkSlot={hunkSlot} /> : <p className="faint">No text diff in this preview.</p>}
  </>;
}
