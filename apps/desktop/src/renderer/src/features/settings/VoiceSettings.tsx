import { useEffect, useState } from "react";
import type { DictationSettingsPane, PetVoiceStatus } from "@capsule/shared";
import { dictationUnavailableReason } from "../../lib/dictation";
import { shortcutLabel } from "../../lib/keybindings";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";

/*
 * Dictation and the companion share one on-device speech helper. When either
 * fails, the cause is almost always a macOS permission or a missing English
 * recognition model, so this card says which and opens the pane that fixes it.
 */
export function VoiceSettings() {
  const { api, keyBindings } = useWorkspace();
  const unavailable = dictationUnavailableReason(api);
  const [status, setStatus] = useState<PetVoiceStatus>();
  const [error, setError] = useState<string>();
  const keys = shortcutLabel("dictation", keyBindings);

  useEffect(() => {
    if (unavailable || typeof api.getPetVoiceStatus !== "function") return;
    let alive = true;
    void api.getPetVoiceStatus().then((value) => { if (alive) setStatus(value); }, () => { if (alive) setError("Could not check speech recognition."); });
    return () => { alive = false; };
  }, [api, unavailable]);

  const open = (pane: DictationSettingsPane) => { void api.openDictationSettings(pane).catch(() => setError("Could not open System Settings.")); };
  const ready = status?.inputAvailable === true;

  return (
    <div className="card voice-settings">
      <h3>Voice</h3>
      <p className="muted">Dictation and the desktop companion use on-device speech recognition. Audio stays on this Mac.</p>
      {unavailable ? <p className="faint">{unavailable}</p> : <>
        <SettingRow
          label="Speech recognition"
          hint={!status && !error ? "Checking speech recognition…"
            : ready ? `Available on this Mac. To dictate, press ${keys ? `${keys} or ` : ""}the microphone in the composer.`
            : error ?? status?.detail ?? "Speech recognition is unavailable."}
        >
          {null}
        </SettingRow>
        <SettingRow label="Permissions" hint="If macOS blocked Capsule, allow it in Privacy & Security.">
          <div className="setting-inline settings-inline-tight">
            <button className="ghost" type="button" onClick={() => open("microphone")}>Microphone</button>
            <button className="ghost" type="button" onClick={() => open("speech")}>Speech Recognition</button>
          </div>
        </SettingRow>
        <SettingRow label="Language" hint="Dictation uses your system language when this Mac can recognize it on device, and US English otherwise. Companion commands are in English. Add languages under Dictation in Keyboard settings.">
          <button className="ghost" type="button" onClick={() => open("dictation")}>Keyboard settings</button>
        </SettingRow>
      </>}
    </div>
  );
}
