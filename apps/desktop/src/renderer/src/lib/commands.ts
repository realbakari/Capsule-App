import { useEffect, useState } from "react";
import type { CommandList, CommandSource, CommandSummary } from "@capsule/shared";
import { formatUserError } from "./errors";

export const COMMAND_SOURCE_LABELS: Record<CommandSource, string> = {
  project: "project",
  user: "user",
  plugin: "plugin",
  claude: "from claude",
  codex: "from codex",
};

/** The command a draft starts with, when it is `/name` followed by nothing or a space. */
export function commandInDraft(draft: string, commands: readonly CommandSummary[] | undefined): CommandSummary | undefined {
  const name = /^\/([a-z0-9][a-z0-9:_-]*)(?:\s|$)/.exec(draft.trimStart())?.[1];
  return name ? commands?.find((command) => command.name === name) : undefined;
}

export function commandDetail(command: CommandSummary): string | undefined {
  return [command.argumentHint, command.description].filter(Boolean).join(" · ") || undefined;
}

type CommandApi = Pick<typeof window.capsule, "commandsList" | "on">;

/**
 * Capsule commands for a project, read again whenever configuration changes:
 * an edited command file, a source turned on, a folder trusted.
 */
export function useCommandList(api: CommandApi, projectId: string | undefined, enabled = true): { list?: CommandList; error?: string; reload: () => void } {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ projectId?: string; list?: CommandList; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    const off = api.on("state", (payload) => {
      if ((payload as { command?: string }).command === "config-updated") setVersion((value) => value + 1);
    });
    return () => { off(); };
  }, [api, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void api.commandsList(projectId)
      .then((list) => { if (current) setState({ projectId, list }); })
      .catch((error: unknown) => { if (current) setState({ projectId, error: formatUserError(error) }); });
    return () => { current = false; };
  }, [api, projectId, enabled, version]);
  // A reread keeps showing the list it replaces; another project's list is never shown.
  const mine = state?.projectId === projectId ? state : undefined;
  return { list: mine?.list, error: mine?.error, reload: () => setVersion((value) => value + 1) };
}
