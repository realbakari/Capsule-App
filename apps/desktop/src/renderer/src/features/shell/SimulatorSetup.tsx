import type { SimulatorInventory } from "@capsule/shared";
import { CheckIcon, CopyIcon, SmartphoneIcon } from "./icons";

const DOWNLOAD_COMMAND = "xcodebuild -downloadPlatform iOS";

/**
 * What stands between this Mac and a simulator, as steps that tick themselves
 * off: the pane re-reads the device list on a timer, so each step clears as
 * soon as it is done, without a reload.
 */
export function SimulatorSetup({ inventory, onCopy }: { inventory: SimulatorInventory; onCopy: (text: string) => void }) {
  const xcode = inventory.supported;
  const devices = inventory.devices.length > 0;
  const steps = [
    { done: xcode, title: "Install Xcode", detail: inventory.reason ?? "From the Mac App Store. Open it once so it can finish installing its tools." },
    { done: devices, title: "Download the iOS platform", detail: "In Xcode, Settings → Components, or run this in a terminal:", command: DOWNLOAD_COMMAND },
    { done: devices, title: "Create a simulator", detail: "In Xcode, Window → Devices and Simulators. It appears here as soon as it exists." },
  ];
  const current = steps.findIndex((step) => !step.done);
  return (
    <div className="panel-tool-pane simulator-empty simulator-setup">
      <SmartphoneIcon size={28} />
      <h3>Set up a simulator</h3>
      <p>These steps tick off by themselves as they are done.</p>
      <ol className="simulator-setup-steps">
        {steps.map((step, index) => (
          <li key={step.title} data-state={step.done ? "done" : index === current ? "current" : "todo"}>
            <span className="simulator-setup-mark" aria-hidden>{step.done ? <CheckIcon size={12} /> : index + 1}</span>
            <div>
              <b>{step.title}</b>
              <span className="sr-only">{step.done ? " (done)" : ""}</span>
              {!step.done && index === current ? <p>{step.detail}</p> : null}
              {!step.done && index === current && step.command ? (
                <span className="simulator-setup-command">
                  <code>{step.command}</code>
                  <button type="button" className="icon-btn" title="Copy the command" aria-label="Copy the command" onClick={() => onCopy(step.command!)}><CopyIcon size={13} /></button>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
