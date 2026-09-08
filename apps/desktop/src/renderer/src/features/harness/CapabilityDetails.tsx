import { harnessCapabilities, type HarnessLiveStatus, type HarnessStatus, type SessionRef } from "@capsule/shared";
import { useEffect, useRef } from "react";
import { AgentConfiguration } from "./AgentConfiguration";

export function CapabilityDetails(props: { harness?: HarnessStatus; session?: SessionRef; status?: HarnessLiveStatus; compact?: boolean }) {
  const capabilities = harnessCapabilities(props);
  const report = props.status?.session.id === props.session?.id
    && props.status?.session.openclawSessionKey === props.session?.openclawSessionKey ? props.status?.parsed?.reported : undefined;
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
    <div className="capability-details-body">
    <dl>{([
      ["Model selection", capabilities.model], ["Live options", capabilities.tuning],
      ["Steer turn", capabilities.steer], ["Agent browser tools", capabilities.browser], ["Permissions", capabilities.permissions],
    ] as const).map(([featureLabel, feature]) => <div key={featureLabel}>
      <dt>{featureLabel}<span data-availability={feature.state}>{feature.state === "available" ? "Available" : feature.state === "limited" ? "Limited" : "Unavailable"}</span></dt>
      <dd>{feature.detail}</dd>
    </div>)}</dl>
    {capabilities.route === "direct" && props.session?.id && Boolean(report?.configOptions.length) &&
      <AgentConfiguration key={`${props.session.id}:${props.session.openclawSessionKey}`} sessionId={props.session.id} options={report!.configOptions} />}
    <details className="advanced">
      <summary>Reported by agent</summary>
      {!report ? <p className="faint">Negotiated metadata is not reported on this session's route. Refresh its status in Harnesses.</p> : <>
        <p>{report.name ?? "Agent"}{report.version ? ` · ${report.version}` : ""}</p>
        <p className="faint">Reported support does not enable a control unless Capsule can carry that operation on this route. This bounded summary may omit additional settings or choices.</p>
        <dl>{([ ["Image prompts", report.images], ["Embedded context", report.embeddedContext],
          ["HTTP MCP", report.httpMcp], ["Session loading", report.loadSession], ["Session resume", report.resumeSession] ] as const).map(([label, available]) =>
          <div key={label}><dt>{label}</dt><dd>{available === undefined ? "Not reported" : available ? "Reported supported" : "Reported unsupported"}</dd></div>)}</dl>
        {report.configOptions.length > 0 && <details className="advanced"><summary>Reported settings · {report.configOptions.length}</summary>
          <dl>{report.configOptions.map((option) => <div key={option.id}><dt>{option.name}</dt>
            <dd>{option.type === "boolean" ? option.booleanValue === undefined ? "Not reported" : option.booleanValue ? "On" : "Off" : option.choices.find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue ?? "Not reported"} · {option.type === "boolean" ? "Boolean" : `${option.choices.length} choices`}</dd></div>)}</dl>
        </details>}
      </>}
    </details>
    </div>
  </details>;
}
