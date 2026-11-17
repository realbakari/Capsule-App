import type { CapsuleSettings, RuntimeMode } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";

const OPTIONS: Array<{ id: RuntimeMode; label: string; detail: string }> = [
  { id: "direct", label: "This computer", detail: "Agents run here with their own sign-in. No Gateway needed." },
  { id: "auto", label: "Automatic", detail: "Through the Gateway when one is connected, otherwise on this computer." },
  { id: "openclaw", label: "Gateway", detail: "Through the connected Gateway. Agents it cannot carry still run here." },
];

/**
 * Who carries a new conversation's turns. Existing conversations keep theirs.
 * Only someone with a Gateway changes it, so it sits under Advanced.
 */
export function RuntimeModeRow({
  settings,
  onPatch,
}: {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void | Promise<void>;
}) {
  const { harnesses } = useWorkspace();
  const mode = settings.runtimeMode;
  const selected = OPTIONS.find((option) => option.id === mode) ?? OPTIONS[0]!;
  const local = harnesses.filter((harness) => harness.directCommand || harness.acpxCommand || harness.nativeCommand);
  const gatewayOnly = harnesses.filter((harness) => !harness.directCommand && !harness.acpxCommand && !harness.nativeCommand && harness.featured);
  const reach = mode === "openclaw" ? "" : local.length === 0
    ? " No agent here can run without a Gateway."
    : gatewayOnly.length > 0 ? ` ${gatewayOnly.map((harness) => harness.name).join(" and ")} need${gatewayOnly.length === 1 ? "s" : ""} a Gateway.` : "";

  return (
    <SettingRow label="Where agents run" setting="runtimeMode" hint={`${selected.detail}${reach} Existing conversations keep theirs.`}>
      <select
        className="field-select"
        aria-label="Where agents run"
        value={mode}
        onChange={(event) => void onPatch({ runtimeMode: event.target.value as RuntimeMode })}
      >
        {OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </SettingRow>
  );
}
