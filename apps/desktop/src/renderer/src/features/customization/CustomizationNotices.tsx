import { useEffect, useRef, useState } from "react";
import type { ConfigSourceReport } from "@capsule/shared";
import { shortConfigPath, sourceFileTarget, trackBrokenFiles, type AnnouncedBreaks } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { XIcon } from "../shell/icons";
import "./customization.css";

/**
 * Workspace-wide notices about the settings files: safe mode, which stays
 * while it is on, and a file that just stopped parsing, announced once.
 */
export function CustomizationNotices() {
  const { api, config, configDiagnostics } = useWorkspace();
  const announced = useRef<AnnouncedBreaks>(new Map());
  const [broken, setBroken] = useState<ConfigSourceReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!configDiagnostics) return;
    const next = trackBrokenFiles(announced.current, configDiagnostics);
    announced.current = next.announced;
    const latest = next.announce.at(-1);
    setBroken((current) => {
      if (latest) return latest;
      const now = current && configDiagnostics.sources.find((source) => source.path === current.path);
      return now && now.state !== "broken" ? undefined : current;
    });
  }, [configDiagnostics]);

  function act(action: () => Promise<unknown>) {
    setError(undefined);
    void action().catch((caught: unknown) => setError(formatUserError(caught)));
  }

  const desktop = api.isDesktop === true;
  return (
    <>
      {config?.safeMode && (
        <div className="customization-banner is-safe-mode" role="status">
          <span>Safe mode: customizations are off.</span>
          {desktop && <button type="button" className="ghost" onClick={() => act(() => api.appRestart({ safeMode: false }))}>Restart normally</button>}
        </div>
      )}
      {broken && (
        <div className="customization-banner is-broken" role="alert">
          <span>
            <b title={broken.path}>{shortConfigPath(broken.path, window.capsule?.homeDir)}</b> has a mistake
            {broken.error ? ` at line ${broken.error.line}, column ${broken.error.column}: ${broken.error.message}.` : "."}{" "}
            {broken.usingLastGood ? "Capsule keeps using its last good copy." : "Its settings do not apply until it parses."}
            {error && <span className="customization-banner-error">{error}</span>}
          </span>
          {desktop && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const target = sourceFileTarget(broken, config?.project?.projectId);
                act(async () => target ? api.configOpenFile(target) : api.openPath(broken.path));
              }}
            >
              Open file
            </button>
          )}
          <button type="button" className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => setBroken(undefined)}>
            <XIcon size={12} />
          </button>
        </div>
      )}
    </>
  );
}
