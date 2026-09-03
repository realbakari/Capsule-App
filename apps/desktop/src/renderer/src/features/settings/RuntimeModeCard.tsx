import type { CapsuleSettings, RuntimeMode } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";

/*
 * Which route carries a coding turn.
 *
 * Capsule has always gone through OpenClaw's ACP bridge, which is what unlocks
 * the Gateway's plugins, channels and remote workers. It is also a daemon to
 * install, run and keep configured before the first turn can happen. An agent
 * that speaks ACP on its own does not need any of that: Capsule can spawn it
 * here and talk to it over its own stdin and stdout.
 */

const OPTIONS: Array<{ id: RuntimeMode; label: string; detail: string }> = [
  {
    id: "auto",
    label: "Automatic",
    detail:
      "Use the OpenClaw Gateway when one is running, and this Mac when none is. Nothing to set up either way.",
  },
  {
    id: "direct",
    label: "Direct",
    detail:
      "Run the agent's CLI here and speak ACP to it. No daemon, no plugin, and it uses the sign-in that CLI already has.",
  },
  {
    id: "openclaw",
    label: "OpenClaw Gateway",
    detail:
      "Always route through the Gateway. Needed for its plugins, its messaging channels, and agents with no ACP mode of their own.",
  },
];

export function RuntimeModeCard({
  settings,
  onPatch,
}: {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void | Promise<void>;
}) {
  const { harnesses } = useWorkspace();
  const mode = settings.runtimeMode;

  /*
   * Named from the catalog rather than written down here: a harness can be
   * driven directly exactly when it has an ACP command of its own, and a list
   * typed into the UI would drift the moment one is added.
   */
  const directCapable = harnesses.filter((harness) => harness.acpxCommand);
  const gatewayOnly = harnesses.filter((harness) => !harness.acpxCommand && harness.featured);

  return (
    <div className="card">
      <h3>Runtime</h3>
      <p className="muted">Who carries a coding turn to the agent.</p>
      <div className="runtime-modes" role="radiogroup" aria-label="Runtime">
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`runtime-mode${mode === option.id ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="runtime-mode"
              checked={mode === option.id}
              onChange={() => void onPatch({ runtimeMode: option.id })}
            />
            <span className="runtime-mode-body">
              <b>{option.label}</b>
              <span className="muted">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {mode !== "openclaw" && (
        <p className="muted runtime-mode-note">
          {directCapable.length > 0 ? (
            <>
              Runs directly: {directCapable.map((harness) => harness.name).join(", ")}.
              {gatewayOnly.length > 0 && (
                <>
                  {" "}
                  {gatewayOnly.map((harness) => harness.name).join(" and ")} have no ACP mode of
                  their own, so they still go through the Gateway.
                </>
              )}
            </>
          ) : (
            <>No installed agent speaks ACP on its own yet, so turns go through the Gateway.</>
          )}
        </p>
      )}
    </div>
  );
}
