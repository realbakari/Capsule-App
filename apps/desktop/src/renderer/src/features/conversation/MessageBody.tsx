import { useMemo } from "react";
import { useWorkspace } from "../../lib/workspace";
import { MarkdownBody } from "./MarkdownBody";
import type { LoadImage } from "./MarkdownImage";

export { MarkdownBody } from "./MarkdownBody";

/**
 * Workspace actions stay outside the pure renderer used by review and
 * previews. `threadImages` reads a reply's local images from the thread's folder.
 */
export function MessageBody({ content, githubBaseUrl, threadImages = false }: { content: string; githubBaseUrl?: string; threadImages?: boolean }) {
  const { api, projectId, project, session, openFile, setBrowserUrl, setInspectorOpen, setInspectorTab } = useWorkspace();
  const root = session?.workingDirectory ?? project?.workingDirectory;
  const loadImage = useMemo<LoadImage | undefined>(() => threadImages && projectId && root ? async (path) => {
    const preview = await api.previewFile(projectId, path, root);
    if (preview.kind !== "image" || !preview.dataUrl) throw new Error(preview.detail ?? "Not an image Capsule can show.");
    return preview.dataUrl;
  } : undefined, [api, projectId, root, threadImages]);
  return <MarkdownBody
    content={content}
    githubBaseUrl={githubBaseUrl}
    onOpenFile={openFile}
    loadImage={loadImage}
    onOpenLink={(href) => {
      setBrowserUrl(href);
      setInspectorTab("browser");
      setInspectorOpen(true);
    }}
  />;
}
