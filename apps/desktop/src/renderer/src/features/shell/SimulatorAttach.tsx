import type { Simulator } from "@capsule/shared";
import { CheckIcon, ChevronDownIcon, XIcon } from "./icons";

/**
 * The screen a device shows before it is attached. Attaching is the consent
 * step: it starts the device if needed, connects touch input, and lets this
 * conversation's agent see and drive it. The card says all three before the
 * button does any of them.
 */
export function SimulatorAttach({ device, devices, supported, agentAccess, busy, menuOpen, onAttach, onToggleMenu }: {
  device: Simulator;
  devices: Simulator[];
  supported: boolean;
  agentAccess: boolean;
  busy: boolean;
  /** The device menu lives outside the phone screen, which clips; the pane draws it. */
  menuOpen: boolean;
  onAttach: (udid: string) => void;
  onToggleMenu: () => void;
}) {

  const touch = device.touch;
  const touchOk = touch.state !== "unavailable" && touch.state !== "failed";
  const stateNote =
    device.state === "Shutdown" ? "This simulator is shut down. Attaching starts it."
      : device.state === "Booted" ? "This simulator is running."
        : `This simulator is ${device.state.toLowerCase()}.`;

  return (
    <div className="simulator-attach">
      <h3>Attach a simulator so your agent can see your app</h3>
      <p>
        {agentAccess
          ? "Capsule will show this simulator here, let you tap it, and let this conversation’s agent control it and take screenshots of its entire screen."
          : "Capsule will show this simulator here and let you tap it. Agent access is off in Settings, so agents cannot see or drive it."}
      </p>
      <p>{stateNote}</p>
      <ul className="simulator-attach-checks">
        <li data-ok={supported}>
          {supported ? <CheckIcon size={14} /> : <XIcon size={14} />}
          <span>{supported ? "Xcode and Simulator installed" : "Xcode and Simulator not found"}</span>
        </li>
        <li data-ok={touchOk}>
          {touchOk ? <CheckIcon size={14} /> : <XIcon size={14} />}
          <span>{touchOk ? "Touch input available" : touch.detail}</span>
        </li>
      </ul>
      <div className="simulator-attach-foot">
        <small>Xcode is a trademark of Apple Inc., registered in the U.S. and other countries.</small>
        <div className="simulator-attach-actions">
          <button type="button" className="simulator-attach-button" disabled={busy || !supported || device.state === "Shutting Down"} onClick={() => onAttach(device.udid)}>
            {busy ? "Attaching…" : "Attach simulator"}
          </button>
          <button type="button" className="simulator-attach-more" aria-label="Choose another simulator" aria-expanded={menuOpen} disabled={busy || devices.length < 2} onClick={onToggleMenu}>
            <ChevronDownIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
