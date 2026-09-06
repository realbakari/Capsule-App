import { harnessCapabilities, type HarnessLiveStatus, type HarnessStatus, type SessionRef } from "@capsule/shared";
import { useEffect, useRef } from "react";

export function CapabilityDetails(props: { harness?: HarnessStatus; session?: SessionRef; status?: HarnessLiveStatus; compact?: boolean }) {
  const capabilities = harnessCapabilities(props);
  const root = useRef<HTMLDetailsElement>(null);
  const label = `${props.harness?.name ?? "Agent"} · ${capabilities.route === "direct" ? "Direct" : capabilities.route ? "Gateway" : "No route"} · Capabilities`;
  useEffect(() => {
    if (!props.compact) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) root.current?.removeAttribute("open"); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [props.compact]);
  return <details ref={root} className={`capability-details${props.compact ? " capability-details--compact" : ""}`} onKeyDown={(event) => { if (event.key === "Escape") { root.current?.removeAttribute("open"); root.current?.querySelector("summary")?.focus(); } }}>
    <summary aria-label={label} title={label}>{props.compact ? <span aria-hidden>ⓘ</span> : label}</summary>
    <dl>{([
      ["Model selection", capabilities.model], ["Live options", capabilities.tuning],
      ["Steer turn", capabilities.steer], ["Agent browser tools", capabilities.browser], ["Permissions", capabilities.permissions],
    ] as const).map(([featureLabel, feature]) => <div key={featureLabel}>
      <dt>{featureLabel}<span data-availability={feature.state}>{feature.state === "available" ? "Available" : feature.state === "limited" ? "Limited" : "Unavailable"}</span></dt>
      <dd>{feature.detail}</dd>
    </div>)}</dl>
  </details>;
}
