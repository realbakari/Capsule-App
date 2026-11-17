import { useEffect, useState } from "react";
import {
  formatEnvLines,
  parseEnvLines,
  patchAgentOverrides,
  splitArguments,
  type AgentOverride,
  type HarnessStatus,
} from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow, Switch } from "../settings/controls";
import { displayCommand } from "./agent-store-model";

/** What the folded launch options set, so a changed agent says so without opening them. */
export function launchSummary(override: AgentOverride | undefined): string | undefined {
  const parts = [
    override?.binaryPath ? "own binary" : undefined,
    override?.args?.length ? `${override.args.length} extra ${override.args.length === 1 ? "argument" : "arguments"}` : undefined,
    override?.env ? `${Object.keys(override.env).length} environment ${Object.keys(override.env).length === 1 ? "variable" : "variables"}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Per-agent settings in the agent's own detail: whether it shows anywhere
 * else, and how Capsule launches it. Saved to the user's settings file, so
 * they are also editable there and never come from a project's file.
 */
export function AgentLaunchSettings({ harness }: { harness: HarnessStatus }) {
  const { api, settings, updateSettings } = useWorkspace();
  const override = settings?.agentOverrides?.[harness.id];
  const enabled = override?.enabled !== false;
  const editable = api.isDesktop !== false;
  const launches = Boolean(harness.nativeCommand ?? harness.directCommand ?? harness.acpxCommand);

  const save = (patch: AgentOverride) =>
    void updateSettings({ agentOverrides: patchAgentOverrides(settings?.agentOverrides, harness.id, patch) }).catch(() => undefined);

  return <>
    <div className="setting harness-dedication">
      <div className="setting-copy">
        <div>Show this agent</div>
        <p>Off hides it from the composer, the palette and new conversations. It stays listed here so you can turn it back on.</p>
      </div>
      <div className="setting-control">
        <Switch checked={enabled} disabled={!editable} onChange={(value) => save({ enabled: value })} label={`Show ${harness.name}`} />
      </div>
    </div>
    {launches ? <LaunchOptions harness={harness} override={override} editable={editable} save={save} /> : null}
  </>;
}

function LaunchOptions({ harness, override, editable, save }: {
  harness: HarnessStatus;
  override: AgentOverride | undefined;
  editable: boolean;
  save: (patch: AgentOverride) => void;
}) {
  /* Compared as text: a settings refresh brings new arrays with the same contents, which must not reset a draft. */
  const savedBinary = override?.binaryPath ?? "";
  const savedArgs = displayCommand(override?.args ?? []);
  const savedEnv = formatEnvLines(override?.env);
  const [binary, setBinary] = useState(savedBinary);
  const [args, setArgs] = useState(savedArgs);
  const [env, setEnv] = useState(savedEnv);
  useEffect(() => setBinary(savedBinary), [savedBinary]);
  useEffect(() => setArgs(savedArgs), [savedArgs]);
  useEffect(() => setEnv(savedEnv), [savedEnv]);
  const envProblem = parseEnvLines(env).invalid[0];
  const summary = launchSummary(override);
  const command = (harness.nativeCommand ?? harness.directCommand ?? harness.acpxCommand)?.command ?? harness.binaries[0];

  return <details className="advanced harness-launch" open={Boolean(summary) || undefined}>
    <summary>Launch options{summary ? <span className="faint"> · {summary}</span> : null}</summary>
    <p className="faint harness-launch-note">
      {harness.runtimeRoute === "direct"
        ? `Used each time Capsule starts ${harness.name}. Conversations already open keep how they started.`
        : `${harness.name} runs through the Gateway now, which starts it from the Gateway host's own setup, so these are not used. They apply when Capsule runs it on this computer.`}
    </p>
    <SettingRow label="Binary path" hint={`Run this program instead of the ${command} found on PATH.`} stacked>
      <input
        type="text"
        className="field mono"
        value={binary}
        disabled={!editable}
        placeholder={harness.binaryPath ?? command}
        aria-label={`${harness.name} binary path`}
        onChange={(event) => setBinary(event.target.value)}
        onBlur={() => { if (binary.trim() !== savedBinary) save({ binaryPath: binary.trim() || undefined }); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
    </SettingRow>
    <SettingRow label="Extra arguments" hint="Added after the ones Capsule passes. Quote an argument that has spaces." stacked>
      <input
        type="text"
        className="field mono"
        value={args}
        disabled={!editable}
        placeholder="--flag value"
        aria-label={`${harness.name} extra arguments`}
        onChange={(event) => setArgs(event.target.value)}
        onBlur={() => {
          const next = splitArguments(args);
          if (displayCommand(next) !== savedArgs) save({ args: next.length ? next : undefined });
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
    </SettingRow>
    <SettingRow
      label="Environment"
      hint={envProblem ? `Not saved: "${envProblem}" is not NAME=value.` : "One NAME=value per line, such as a config folder for a second account. ~/ means your home folder."}
      stacked
    >
      <textarea
        className="field mono"
        rows={3}
        value={env}
        disabled={!editable}
        placeholder="CONFIG_DIR=~/.agent-work"
        aria-label={`${harness.name} environment`}
        aria-invalid={Boolean(envProblem) || undefined}
        onChange={(event) => setEnv(event.target.value)}
        onBlur={() => {
          const parsed = parseEnvLines(env);
          if (parsed.invalid.length || formatEnvLines(parsed.env) === savedEnv) return;
          save({ env: Object.keys(parsed.env).length ? parsed.env : undefined });
        }}
      />
    </SettingRow>
  </details>;
}
