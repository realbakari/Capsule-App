import { useEffect, useState } from "react";
import { modelFavoriteKey, normalizeFavoriteModels, type CapsuleSettings, type Run, type Session, type TurnMode } from "@capsule/shared";
import type { CapsuleApi } from "../../../preload/index";
import { formatUserError } from "./errors";

/** ⌥⌘M and the palette ask the composer, which knows the agent's models, to move to the next favorite. */
export const CYCLE_FAVORITE_MODEL_EVENT = "capsule:cycle-favorite-model";

/** Plan or Act for the selected thread, or for the thread a first message will create. */
export function useTurnMode(input: {
  api: CapsuleApi;
  session?: Session;
  settings?: CapsuleSettings;
  setNotice: (value: string | undefined) => void;
}) {
  const { api, session, settings, setNotice } = input;
  const [draft, setDraft] = useState<TurnMode>();
  /* The engine's answer arrives with the next refresh; until then the chip shows the choice. */
  const [pending, setPending] = useState<{ sessionId: string; mode: TurnMode }>();
  useEffect(() => { setDraft(undefined); }, [session?.id, session?.projectId]);
  useEffect(() => {
    if (pending && pending.sessionId === session?.id && (session.turnMode ?? "act") === pending.mode) setPending(undefined);
  }, [pending, session?.id, session?.turnMode]);
  const draftTurnMode: TurnMode = draft ?? (settings?.startInPlanMode ? "plan" : "act");
  const turnMode: TurnMode = !session ? draftTurnMode
    : pending?.sessionId === session.id ? pending.mode : session.turnMode ?? "act";

  async function setTurnMode(mode: TurnMode): Promise<boolean> {
    if (!session) { setDraft(mode); return true; }
    setPending({ sessionId: session.id, mode });
    try {
      const result = await api.setSessionTurnMode(session.id, mode);
      if (result.detail) setNotice(result.detail);
      return true;
    } catch (error) {
      setPending(undefined);
      setNotice(formatUserError(error));
      return false;
    }
  }

  return { turnMode, draftTurnMode, setTurnMode };
}

/** The newest finished turn of this thread, when it was a plan that can be acted on. */
export function latestPlanRun(runs: readonly Run[], sessionId: string | undefined): Run | undefined {
  if (!sessionId) return undefined;
  const latest = runs.filter((run) => run.sessionId === sessionId)
    .reduce<Run | undefined>((newest, run) => !newest || run.createdAt > newest.createdAt ? run : newest, undefined);
  return latest?.turnMode === "plan" && latest.status === "completed" ? latest : undefined;
}

const LEGACY_FAVORITES_KEY = "capsule.model-favorites";

/**
 * Favorites live in settings so every window, the remote viewer and a reinstall
 * see the same list. A list an older build kept in this window moves over once.
 */
export function useFavoriteModels(settings: CapsuleSettings | undefined, updateSettings: (patch: Partial<CapsuleSettings>) => Promise<CapsuleSettings>, canWrite: boolean) {
  const favorites = settings?.favoriteModels ?? [];
  useEffect(() => {
    if (!settings || !canWrite) return;
    let legacy: string[] = [];
    try { legacy = normalizeFavoriteModels(JSON.parse(localStorage.getItem(LEGACY_FAVORITES_KEY) ?? "[]")); }
    catch { /* An unreadable list has nothing to move. */ }
    if (!legacy.length) { try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch { /* Storage unavailable. */ } return; }
    void updateSettings({ favoriteModels: [...settings.favoriteModels, ...legacy.filter((key) => !settings.favoriteModels.includes(key))] })
      .then(() => { try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch { /* Storage unavailable. */ } })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(settings), canWrite]);
  function toggleFavorite(agentId: string, modelId: string) {
    const key = modelFavoriteKey(agentId, modelId);
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    return updateSettings({ favoriteModels: next });
  }
  return { favorites, toggleFavorite };
}
