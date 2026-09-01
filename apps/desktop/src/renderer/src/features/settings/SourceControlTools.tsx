import { useEffect, useState } from "react";
import { useWorkspace } from "../../lib/workspace";

interface ToolStatus {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
  account?: string;
  guidance?: string;
}

/**
 * What source-control tooling this machine has.
 *
 * Only the tools Capsule actually uses appear. A row that is missing or signed
 * out says what to do about it rather than only that something is wrong — the
 * same rule the inspector's disabled surfaces follow.
 */
export function SourceControlTools() {
  const { api } = useWorkspace();
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void (async () => {
      try {
        const next = (await api.sourceControlTools()) as ToolStatus[];
        if (!cancelled) setTools(next);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, nonce]);

  return (
    <div className="card">
      <div className="settings-crumbbar">
        <h3>Tooling</h3>
        <button
          type="button"
          className="ghost"
          disabled={checking}
          onClick={() => setNonce((value) => value + 1)}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>

      {!tools && <p className="muted">Checking…</p>}

      {tools?.map((tool) => (
        <div className="tool-row" key={tool.id}>
          <span className={`tool-dot ${tool.installed ? "on" : "off"}`} aria-hidden />
          <div className="tool-body">
            <span className="tool-head">
              <span className="tool-name">{tool.name}</span>
              {tool.version && <code className="tool-version">{tool.version}</code>}
              {tool.account && <span className="tool-account">as {tool.account}</span>}
            </span>
            {tool.guidance && <p className="tool-guidance">{tool.guidance}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
