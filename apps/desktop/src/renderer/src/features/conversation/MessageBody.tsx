import { useCallback, useMemo, useState } from "react";
import { useWorkspace } from "../../lib/workspace";
import { showNativeContextMenu } from "../../lib/bridge";
import { ActionMenu } from "../shell/ActionMenu";
import { MarkdownBody } from "./MarkdownBody";
import type { LoadImage } from "./MarkdownImage";
import { linkMenuItems, openInSystemBrowser, runLinkAction } from "./link-actions";
import type { ActionMenuItem } from "../../lib/action-menu";

export { MarkdownBody } from "./MarkdownBody";

/**
 * Workspace actions stay outside the pure renderer used by review and
 * previews. `threadImages` reads a reply's local images from the thread's folder.
 *
 * A web link opens in the browser panel; Option-click and the link's menu
 * reach the system browser. A paired device has no browser panel, so there a
 * link opens in a new tab of that device's browser.
 */
export function MessageBody({ content, githubBaseUrl, threadImages = false }: { content: string; githubBaseUrl?: string; threadImages?: boolean }) {
  const { api, projectId, project, session, openFile, setBrowserUrl, setInspectorOpen, setInspectorTab, setNotice } = useWorkspace();
  const root = session?.workingDirectory ?? project?.workingDirectory;
  const loadImage = useMemo<LoadImage | undefined>(() => threadImages && projectId && root ? async (path) => {
    const preview = await api.previewFile(projectId, path, root);
    if (preview.kind !== "image" || !preview.dataUrl) throw new Error(preview.detail ?? "Not an image Capsule can show.");
    return preview.dataUrl;
  } : undefined, [api, projectId, root, threadImages]);
  /* The browser panel is the desktop app's; whether there is one is read when a link is used. */
  const openLink = useCallback((href: string) => {
    if (api.isDesktop === false) { openInSystemBrowser(href); return; }
    setBrowserUrl(href);
    setInspectorTab("browser");
    setInspectorOpen(true);
  }, [api, setBrowserUrl, setInspectorOpen, setInspectorTab]);
  const run = useCallback((action: string, href: string) => {
    void runLinkAction(action, href, openLink).catch(() => setNotice("Couldn’t copy the link."));
  }, [openLink, setNotice]);
  const [menu, setMenu] = useState<{ href: string; point: { x: number; y: number }; items: ActionMenuItem[] }>();
  const onLinkMenu = useCallback((href: string, point: { x: number; y: number }) => {
    const items = linkMenuItems(api.isDesktop !== false);
    void showNativeContextMenu(items, point).then((picked) => {
      if (picked === "unavailable") setMenu({ href, point, items });
      else if (picked) run(picked, href);
    });
  }, [api, run]);
  return <>
    <MarkdownBody
      content={content}
      githubBaseUrl={githubBaseUrl}
      onOpenFile={openFile}
      loadImage={loadImage}
      onOpenLink={openLink}
      onLinkMenu={onLinkMenu}
    />
    {menu && <ActionMenu items={menu.items} point={menu.point} onClose={() => setMenu(undefined)}
      onSelect={(action) => { setMenu(undefined); run(action, menu.href); }} />}
  </>;
}
