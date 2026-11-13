import { useCallback, useEffect, useState } from "react";
import type { OpenInCatalog, OpenInTarget } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";

export type CatalogState =
  | { status: "loading"; catalog?: OpenInCatalog }
  | { status: "ready"; catalog: OpenInCatalog }
  | { status: "error"; error: string; catalog?: OpenInCatalog };

/** The apps that can open this target, reloaded when the target or the saved list changes. */
export function useOpenInCatalog(target: OpenInTarget | undefined, enabled = true): CatalogState & { reload: () => void } {
  const { api, settings } = useWorkspace();
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([target?.projectId, target?.sessionId, target?.path, settings?.openInApps, settings?.openInHidden, settings?.openInFavorite, nonce]);
  useEffect(() => {
    if (!enabled || api.isDesktop === false) return undefined;
    let live = true;
    setState((current) => ({ status: "loading", catalog: current.catalog }));
    api.listOpenInApps(target?.projectId, target?.sessionId, target?.path).then(
      (catalog) => { if (live) setState({ status: "ready", catalog }); },
      (error: unknown) => { if (live) setState((current) => ({ status: "error", error: formatUserError(error), catalog: current.catalog })); },
    );
    return () => { live = false; };
    // The key carries every input that changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, api]);
  return { ...state, reload: useCallback(() => setNonce((value) => value + 1), []) };
}

/**
 * Open a target with an app and remember the app as the favourite, the way
 * the shortcut and the primary button will use it next time.
 */
export function useOpenIn() {
  const { api, settings, updateSettings, setNotice } = useWorkspace();
  return useCallback(async (appId: string, target: OpenInTarget): Promise<boolean> => {
    try {
      await api.openInApp(appId, target.projectId, target.sessionId, target.path);
    } catch (error) {
      setNotice(formatUserError(error));
      return false;
    }
    if (settings?.openInFavorite !== appId) {
      await updateSettings({ openInFavorite: appId }).catch((error: unknown) => setNotice(formatUserError(error)));
    }
    return true;
  }, [api, settings?.openInFavorite, updateSettings, setNotice]);
}
