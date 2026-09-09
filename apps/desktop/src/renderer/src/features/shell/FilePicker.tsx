import { useEffect, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { searchProjectFiles } from "../../lib/bridge";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { FileIcon } from "./icons";
import { SearchDialog } from "./SearchDialog";

export function FilePicker() {
  const { api, filePicker, setFilePicker, projectId, project, session, mentionFile, pickProjectDirectory, pickFilesToMention } = useWorkspace();
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const root = session && session.projectId === projectId ? session.workingDirectory ?? project?.workingDirectory : project?.workingDirectory;
  const scope = JSON.stringify([projectId, root, query]);
  const [result, setResult] = useState<{ scope: string; files?: FileEntry[]; error?: string }>();
  const currentResult = result?.scope === scope ? result : undefined;

  useEffect(() => {
    if (!filePicker || !projectId || !root) return;
    let current = true;
    setResult(undefined);
    const timer = setTimeout(() => {
      void searchProjectFiles(projectId, query, root).then((files) => {
        if (current) setResult({ scope, files });
      }).catch((error) => {
        if (current) setResult({ scope, error: formatUserError(error) });
      });
    }, 100);
    return () => { current = false; clearTimeout(timer); };
  }, [filePicker, projectId, root, query, scope, retry]);

  useEffect(() => { if (!filePicker) setQuery(""); }, [filePicker]);
  if (!filePicker) return null;
  const files = currentResult?.files?.filter((file) => file.type === "file").slice(0, 40) ?? [];
  const empty = root ? "No matching files in this checkout." : <div>
    <p>Attach a project folder to search its files.</p>
    <div className="actions">
      <button type="button" disabled={api.isDesktop === false} onClick={() => { setFilePicker(false); void pickProjectDirectory(); }}>Open folder</button>
      <button type="button" disabled={api.isDesktop === false} onClick={() => { setFilePicker(false); void pickFilesToMention(); }}>Open files</button>
    </div>
  </div>;
  return <SearchDialog key={JSON.stringify([projectId, root])} title="Search files" placeholder="Search files in this checkout…" query={query} selectLabel="Mention"
    onQueryChange={setQuery} status={projectId && root && !currentResult ? "Searching this checkout…" : undefined}
    error={currentResult?.error} onRetry={() => setRetry((value) => value + 1)} empty={empty}
    items={files.map((file) => ({
      id: file.path, label: file.name, detail: file.path, group: "Current checkout", icon: <FileIcon size={15} />,
      onSelect: () => mentionFile(file.path),
    }))} onClose={() => { setFilePicker(false); setQuery(""); }} />;
}
