import { useState, type DragEvent } from "react";
import { formatUserError } from "../../lib/errors";
import { useToasts } from "../../lib/toasts";
import { useWorkspace } from "../../lib/workspace";
import "./folder-drop.css";

const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** Only a drag from outside the app carrying files; a row being reordered is not one. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Drop folders from Finder on the sidebar to add them as projects. A folder
 * that already is a project is opened instead of added twice; files are
 * refused with a reason, since a project is a folder. The desktop only: a
 * paired browser cannot read paths from its own disk into this Mac.
 */
export function useFolderDrop() {
  const { api, projects, setProjectId, setView, refresh } = useWorkspace();
  const { show } = useToasts();
  const [over, setOver] = useState(false);
  const enabled = api.isDesktop !== false && typeof api.getPathForFile === "function";

  async function add(paths: string[], skipped: number) {
    let opened: string | undefined;
    for (const directory of paths) {
      const existing = projects.find((project) => project.workingDirectory === directory);
      if (existing) { opened = existing.id; continue; }
      try {
        const created = await api.createProject({ name: baseName(directory), workingDirectory: directory });
        opened = created.id;
        show({ key: `folder:${directory}`, tone: "success", title: `Added “${baseName(directory)}”` });
      } catch (error) {
        show({ key: `folder:${directory}`, tone: "error", title: `Could not add “${baseName(directory)}”`, detail: formatUserError(error) });
      }
    }
    if (skipped > 0) show({ key: "folder-drop", tone: "info", title: skipped === 1 ? "A file was not added" : `${skipped} files were not added`, detail: "Drop a folder to add it as a project." });
    await refresh();
    if (opened) { setProjectId(opened); setView("chat"); }
  }

  if (!enabled) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); setOver(true); } },
      onDragOver: (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setOver(false);
        const folders: string[] = [];
        let skipped = 0;
        for (const item of Array.from(event.dataTransfer.items)) {
          const file = item.getAsFile();
          if (!file) continue;
          const path = api.getPathForFile(file);
          if (path && item.webkitGetAsEntry()?.isDirectory) folders.push(path);
          else skipped++;
        }
        void add(folders, skipped);
      },
    },
  };
}
