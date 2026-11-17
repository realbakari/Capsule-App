import { useMemo, useRef } from "react";
import { OPEN_IN_DEFAULT_APP } from "@capsule/shared";
import type { ActionMenuItem } from "../../lib/action-menu";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import {
  fileRowAbsolutePath,
  fileRowMention,
  fileRowMenuItems,
  type FileRow,
  type FileRowAction,
  type FileRowKind,
} from "./file-row-actions";

export interface FileRowActions {
  items: (kind: FileRowKind) => ActionMenuItem[];
  run: (action: FileRowAction, row: FileRow) => void;
}

/**
 * The Files tree's row menu. The returned object never changes, so the
 * memoized tree does not redraw on every workspace update; each call reads
 * the workspace as it is now.
 */
export function useFileRowActions(onPreview: (path: string) => void): FileRowActions {
  const workspace = useWorkspace();
  const latest = useRef({ workspace, onPreview });
  latest.current = { workspace, onPreview };
  return useMemo<FileRowActions>(() => ({
    items: (kind) => {
      const { api, settings } = latest.current.workspace;
      return fileRowMenuItems(kind, { host: api.isDesktop !== false, platform: api.platform, favorite: settings?.openInFavorite });
    },
    run: (action, row) => {
      const { workspace: { api, projectId, project, session, settings, mentionFile, setNotice }, onPreview: preview } = latest.current;
      const fail = (error: unknown) => setNotice(formatUserError(error));
      const absolute = fileRowAbsolutePath(row);
      switch (action) {
        case "preview": preview(row.path); break;
        case "mention": mentionFile(fileRowMention(row, session?.workingDirectory ?? project?.workingDirectory)); break;
        case "copy-path": navigator.clipboard.writeText(absolute).catch(fail); break;
        case "copy-relative-path": navigator.clipboard.writeText(row.path).catch(fail); break;
        // Called directly rather than through the picker's hook, which would make the default app the favourite.
        case "open-in": if (projectId) api.openInApp(settings?.openInFavorite ?? OPEN_IN_DEFAULT_APP, projectId, session?.id, absolute).catch(fail); break;
        case "reveal": if (projectId) api.revealInFolder(projectId, session?.id, absolute).catch(fail); break;
      }
    },
  }), []);
}
