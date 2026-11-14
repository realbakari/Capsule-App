import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  allHunks,
  DIFF_SCOPES,
  hunkActions,
  hunkStage,
  parseUnifiedDiff,
  type DiffFile,
  type DiffScope,
  type HunkAction,
  type ReviewFileDiffs,
} from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import type { ReviewSelection } from "../../lib/review-scope";
import { useWorkspace } from "../../lib/workspace";
import { DIFF_PAGE_FILES, DiffPager } from "../shell/DiffPager";
import { FileDiff } from "../shell/FileDiff";
import { diffBlockKeys } from "../shell/PagedFileDiffs";
import { HunkTools, type HunkProgress } from "./HunkTools";
import { useViewedFiles } from "./useViewedFiles";

interface Reading {
  files: DiffFile[];
  staged: Map<string, DiffFile>;
  unstaged: Map<string, DiffFile>;
  /** Shown instead of the empty message, such as why a turn has no diff. */
  note?: string;
}

const EMPTY: Record<DiffScope, string> = {
  uncommitted: "No uncommitted changes.",
  staged: "Nothing is staged.",
  unstaged: "No unstaged changes.",
  turn: "This turn changed no files.",
  branch: "No changes on this branch yet.",
};

const KEYS: Partial<Record<string, HunkAction>> = { k: "keep", x: "reject", u: "unstage" };

function byPath(text: string): Map<string, DiffFile> {
  return new Map(parseUnifiedDiff(text).map((file) => [file.path, file]));
}

type Api = ReturnType<typeof useWorkspace>["api"];

async function readScope(api: Api, projectId: string, sessionId: string | undefined, selection: ReviewSelection, path: string | undefined, ignoreWhitespace: boolean): Promise<Reading & { base?: string }> {
  const none = { staged: new Map<string, DiffFile>(), unstaged: new Map<string, DiffFile>() };
  const options = { ignoreWhitespace };
  if (selection.kind === "turn") {
    if (!selection.runId) return { ...none, files: [], note: "No turn in this conversation has saved changes yet." };
    const result = await api.turnDiff(selection.runId, { relative: path, ignoreWhitespace });
    if (result.available === false) return { ...none, files: [], note: "This turn has no earlier checkpoint to compare against, so its changes cannot be told apart from what came before it." };
    return { ...none, files: parseUnifiedDiff(result.patch), note: result.patchTruncated ? "Preview limited to 512 KB. Select a file to see all of its changes." : undefined };
  }
  if (selection.kind === "uncommitted") {
    const [shown, staged, unstaged] = await Promise.all([
      api.gitScopedDiff(projectId, "uncommitted", path, sessionId, options),
      api.gitScopedDiff(projectId, "staged", path, sessionId, options),
      api.gitScopedDiff(projectId, "unstaged", path, sessionId, options),
    ]);
    return { files: parseUnifiedDiff(shown.patch), staged: byPath(staged.patch), unstaged: byPath(unstaged.patch) };
  }
  const result = await api.gitScopedDiff(projectId, selection.kind, path, sessionId, options);
  return { ...none, files: parseUnifiedDiff(result.patch), base: result.base };
}

/**
 * Review's diff: one scope of the checkout's changes or one saved turn, with
 * Keep, Reject and Unstage on each hunk where the scope allows them, and a
 * Viewed mark per file. Acting refreshes the diff in place; a refusal leaves
 * everything as it was and says why on the hunk.
 */
export function ReviewDiff({ projectId, sessionId, thread, selection, ignoreWhitespace, path, onShowAll }: {
  projectId: string;
  sessionId?: string;
  /** Whose Viewed marks these are: the conversation, or the project without one. */
  thread: string;
  selection: ReviewSelection;
  ignoreWhitespace: boolean;
  /** One file, when chosen in the changed-files list; otherwise the whole scope. */
  path?: string;
  onShowAll: () => void;
}) {
  const { api, git, gitApplyHunk, setConfirm } = useWorkspace();
  // Staging a file from the list, or an agent editing one, changes the status; read again.
  const changes = JSON.stringify(git?.files ?? []);
  const scope: DiffScope = selection.kind;
  const viewed = useViewedFiles(thread);
  const readOnly = api.isDesktop === false;
  const key = JSON.stringify([projectId, sessionId, selection, path, ignoreWhitespace]);
  const [reading, setReading] = useState<{ key: string; value?: Reading & { base?: string }; error?: string }>();
  const [reload, setReload] = useState(0);
  const [progress, setProgress] = useState<Record<string, HunkProgress>>({});
  const [collapsed, setCollapsed] = useState<{ key: string; blocks: Map<string, boolean> }>({ key, blocks: new Map() });
  const [page, setPage] = useState({ key, page: 0 });
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ path: string; index: number } | undefined>(undefined);

  useEffect(() => {
    let current = true;
    // A refresh after an action keeps the old reading on screen, so nothing
    // jumps; a new scope or file starts from a loading state.
    setReading((previous) => previous?.key === key ? previous : undefined);
    readScope(api, projectId, sessionId, selection, path, ignoreWhitespace).then(
      (value) => { if (current) { setReading({ key, value }); setProgress({}); } },
      (error) => { if (current) setReading({ key, error: formatUserError(error) }); },
    );
    return () => { current = false; };
    // `selection` and the rest are part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, reload, changes]);

  const current = reading?.key === key ? reading : undefined;
  const files = current?.value?.files;
  const blockKeys = useMemo(() => diffBlockKeys(files ?? []), [files]);

  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target || !files || !root.current) return;
    refocus.current = undefined;
    const owner = Array.from(root.current.querySelectorAll<HTMLElement>("[data-review-file]")).find((element) => element.dataset.reviewFile === target.path);
    const heads = Array.from((owner ?? root.current).querySelectorAll<HTMLElement>("[data-hunk]"));
    (heads[Math.min(target.index, heads.length - 1)] ?? root.current.querySelector<HTMLElement>("[data-hunk]"))?.focus({ preventScroll: true });
  }, [files]);

  const diffsFor = (file: DiffFile): ReviewFileDiffs => ({
    shown: file,
    staged: current?.value?.staged.get(file.path),
    unstaged: current?.value?.unstaged.get(file.path),
  });

  function act(file: DiffFile, hunks: number[], action: HunkAction, slot: string) {
    const plan = hunkActions(scope, diffsFor(file), hunks)[action];
    if (!plan || readOnly) return;
    const run = async () => {
      setProgress((value) => ({ ...value, [slot]: { busy: action } }));
      try {
        await gitApplyHunk(plan);
        refocus.current = { path: file.path, index: hunks[0] ?? 0 };
        setReload((value) => value + 1);
      } catch (error) {
        setProgress((value) => ({ ...value, [slot]: { error: formatUserError(error) } }));
      }
    };
    const whole = hunks.length === file.hunks.length;
    if (action === "reject" && (file.status === "added" || (whole && file.hunks.length > 1))) {
      setConfirm({
        title: file.status === "added" ? `Delete “${file.path}”?` : `Reject every change to “${file.path}”?`,
        detail: file.status === "added"
          ? "This new file is removed from the working tree. Git has no copy of it to bring back."
          : "The file goes back to how it stands in the last commit.",
        danger: true,
        confirmLabel: file.status === "added" ? "Delete file" : "Reject all",
        onConfirm: () => { setConfirm(undefined); void run(); },
      });
      return;
    }
    void run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || !root.current) return;
    const head = (event.target as HTMLElement).closest<HTMLElement>("[data-hunk]");
    if (!head) return;
    const heads = Array.from(root.current.querySelectorAll<HTMLElement>("[data-hunk]"));
    const at = heads.indexOf(head);
    const move = event.key === "j" || event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move) {
      event.preventDefault();
      heads[at + move]?.focus();
      heads[at + move]?.scrollIntoView({ block: "nearest" });
      return;
    }
    const action = KEYS[event.key.toLowerCase()];
    const owner = head.closest<HTMLElement>("[data-review-file]")?.dataset.reviewFile;
    const file = files?.find((item) => item.path === owner);
    if (!action || !file) return;
    event.preventDefault();
    const index = Number(head.dataset.hunk);
    act(file, [index], action, `${file.path}\0${index}`);
  }

  // A whitespace-blind diff is not the patch git would apply, so hunks act only on the full diff.
  const actsOnHunks = !readOnly && !ignoreWhitespace && (scope === "uncommitted" || scope === "staged" || scope === "unstaged");
  const visible = (files ?? []).map((file, index) => ({ file, key: blockKeys[index]! }));
  const currentPage = page.key === key ? page.page : 0;
  const shown = visible.slice(currentPage * DIFF_PAGE_FILES, (currentPage + 1) * DIFF_PAGE_FILES);
  // A file's own fold wins; otherwise a viewed file starts folded.
  const folds = collapsed.key === key ? collapsed.blocks : new Map<string, boolean>();
  const isOpen = (file: DiffFile, block: string) => folds.get(block) ?? !viewed.isViewed(file);
  const fold = (block: string, open: boolean) => setCollapsed(() => ({ key, blocks: new Map(folds).set(block, open) }));

  return (
    <div className="panel-diff-section review-diff" ref={root} onKeyDown={onKeyDown}>
      <div className="review-diff-bar">
        <h4>Diff</h4>
        {path ? <button type="button" className="chip" onClick={onShowAll} title={`Showing ${path}`}>All files</button> : null}
      </div>
      {current?.value?.base ? <p className="faint review-diff-note">Since this branch left {current.value.base}.</p> : null}
      {scope === "turn" || scope === "branch" ? <p className="faint review-diff-note">Read only. Keep and Reject work on Uncommitted, Staged and Unstaged.</p> : null}
      {readOnly && scope !== "turn" && scope !== "branch" ? <p className="faint review-diff-note">Keep and Reject are available on the host.</p> : null}
      {!readOnly && ignoreWhitespace && scope !== "turn" && scope !== "branch" ? <p className="faint review-diff-note">Whitespace is hidden. Turn Ignore whitespace off to keep or reject hunks.</p> : null}
      {!current ? (
        <p className="faint" role="status">Loading diff…</p>
      ) : current.error ? (
        <p role="alert">{current.error} <button type="button" className="ghost" onClick={() => setReload((value) => value + 1)}>Retry</button></p>
      ) : !files?.length ? (
        <p className="faint">{current.value?.note ?? (path ? `No ${DIFF_SCOPES.find((item) => item.id === scope)!.label.toLowerCase()} changes in ${path}.` : ignoreWhitespace ? "No changes besides whitespace." : EMPTY[scope])}</p>
      ) : (
        <div className="review-diff-files">
          {current.value?.note ? <p className="faint review-diff-note">{current.value.note}</p> : null}
          <div className="diff-list-controls">
            {visible.length > DIFF_PAGE_FILES ? <DiffPager page={currentPage} pages={Math.ceil(visible.length / DIFF_PAGE_FILES)} label="Files" onChange={(next) => setPage({ key, page: next })} /> : null}
            <span className="diff-viewed-count" role="status">{visible.filter(({ file }) => viewed.isViewed(file)).length} of {visible.length} viewed</span>
            <button type="button" className="chip" onClick={() => {
              const open = !shown.every(({ file, key: block }) => isOpen(file, block));
              setCollapsed(() => ({ key, blocks: new Map([...folds, ...shown.map(({ key: block }) => [block, open] as const)]) }));
            }}>
              {shown.every(({ file, key: block }) => isOpen(file, block)) ? "Collapse" : "Expand"} {visible.length > DIFF_PAGE_FILES ? "page" : "all"}
            </button>
          </div>
          {shown.map(({ file, key: block }) => {
            const diffs = diffsFor(file);
            const everything = allHunks(file);
            const fileActions = actsOnHunks ? Object.keys(hunkActions(scope, diffs, everything)) as HunkAction[] : [];
            const fileSlot = `${file.path}\0all`;
            return (
              <div key={block} data-review-file={file.path}>
                <FileDiff
                  file={file}
                  split={false}
                  expanded={isOpen(file, block)}
                  onExpandedChange={(open) => fold(block, open)}
                  viewed={viewed.isViewed(file)}
                  onViewedChange={(next) => { viewed.mark(file, next); fold(block, !next); }}
                  tools={fileActions.length > 0 && file.hunks.length > 1 ? (
                    <div className="file-diff-tools">
                      <HunkTools actions={fileActions} scopeLabel="all" progress={progress[fileSlot]}
                        onAct={(action) => act(file, everything, action, fileSlot)} onRetry={() => setReload((value) => value + 1)} />
                    </div>
                  ) : undefined}
                  hunkSlot={actsOnHunks ? {
                    label: (index) => `Hunk ${index + 1} of ${file.hunks.length} in ${file.path}`,
                    render: (index) => {
                      const slot = `${file.path}\0${index}`;
                      return (
                        <HunkTools
                          actions={Object.keys(hunkActions(scope, diffs, [index])) as HunkAction[]}
                          stage={scope === "uncommitted" ? hunkStage(diffs, index) : undefined}
                          progress={progress[slot]}
                          onAct={(action) => act(file, [index], action, slot)}
                          onRetry={() => setReload((value) => value + 1)}
                        />
                      );
                    },
                  } : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
