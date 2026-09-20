import type { CapsuleSettings, RuntimeMode } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";

const OPTIONS: Array<{ id: RuntimeMode; label: string; detail: string }> = [
  {
    id: "direct",
    label: "Direct · local agents",
    detail: "Default for new installations. Run a supported CLI on this computer using its own sign-in. No Gateway required.",
  },
  {
    id: "auto",
    label: "Automatic",
    detail:
      "Use the OpenClaw Gateway when available, or an installed native agent on this computer.",
  },
  {
    id: "openclaw",
    label: "OpenClaw Gateway",
    detail:
      "Use a configured Gateway for supported agents, plugins and messaging channels. Native-only agents still run locally.",
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

  // Both ACP adapters and native session protocols are local transports.
  const directCapable = harnesses.filter((harness) => harness.directCommand || harness.acpxCommand || harness.nativeCommand);
  const gatewayOnly = harnesses.filter((harness) => !harness.directCommand && !harness.acpxCommand && !harness.nativeCommand && harness.featured);

  return (
    <div className="card">
      <h3>Runtime</h3>
      <p className="muted">Choose the route for new conversations. Existing conversations keep their route.</p>
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
                  {gatewayOnly.map((harness) => harness.name).join(" and ")} require a configured Gateway.
                </>
              )}
            </>
          ) : (
            <>Choose an agent with a supported local connection in Harnesses, or connect a Gateway for Gateway-only agents.</>
          )}
        </p>
      )}
    </div>
  );
}
