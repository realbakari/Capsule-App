import type { PluginContents as Contents, PluginOption, PluginOptionValue, PluginProblem } from "@capsule/shared";
import { Switch } from "../settings/controls";

function Section({ title, count, children, single }: { title: string; count: number; children: React.ReactNode; single?: boolean }) {
  if (count === 0) return null;
  return (
    <section className="plugin-section">
      <h4>{title}{!single && <> <span className="faint">{count}</span></>}</h4>
      <ul>{children}</ul>
    </section>
  );
}

/** Everything a plugin adds, as written in its files. The install screen, Validate and the installed list all use it. */
export function PluginContentsList({ contents }: { contents: Contents }) {
  const total = contents.commands.length + contents.hooks.length + contents.mcpServers.length + contents.themes.length
    + contents.profiles.length + contents.styles.length + contents.skills.length + (contents.statusLine ? 1 : 0);
  if (total === 0) return <p className="muted plugin-empty">This plugin adds nothing Capsule reads.</p>;
  return (
    <div className="plugin-contents">
      <Section title="Hooks" count={contents.hooks.length}>
        {contents.hooks.map((hook, index) => (
          <li key={`${hook.event}-${index}`}>
            <span className="plugin-item-head"><strong>{hook.event}</strong>{hook.matcher && <span className="faint">{hook.matcher}</span>}{hook.type === "http" && <span className="plugin-tag">HTTP</span>}</span>
            <code className="plugin-run">{hook.run}</code>
          </li>
        ))}
      </Section>
      <Section title="Commands" count={contents.commands.length}>
        {contents.commands.map((command) => (
          <li key={command.name}>
            <span className="plugin-item-head"><strong>/{command.name}</strong>{command.description && <span className="faint">{command.description}</span>}{command.shell.length > 0 && <span className="plugin-tag" data-runs>! runs shell</span>}</span>
            {command.shell.map((line, index) => <code key={index} className="plugin-run">{line}</code>)}
          </li>
        ))}
      </Section>
      <Section title="MCP servers" count={contents.mcpServers.length}>
        {contents.mcpServers.map((server) => (
          <li key={server.name}>
            <span className="plugin-item-head"><strong>{server.name}</strong><span className="plugin-tag" {...(server.transport === "stdio" ? { "data-runs": true } : {})}>{server.transport === "stdio" ? "starts a program" : "URL"}</span></span>
            <code className="plugin-run">{server.detail}</code>
          </li>
        ))}
      </Section>
      {contents.statusLine && (
        <Section title="Status line" count={1} single>
          <li>
            <span className="plugin-item-head">{contents.statusLine.items.length > 0 ? <span>{contents.statusLine.items.join(", ")}</span> : <span className="faint">No items</span>}{contents.statusLine.command && <span className="plugin-tag" data-runs>runs a command</span>}</span>
            {contents.statusLine.command && <code className="plugin-run">{contents.statusLine.command}</code>}
          </li>
        </Section>
      )}
      <Section title="Themes and backdrops" count={contents.themes.length}>
        {contents.themes.map((theme) => (
          <li key={theme.id}><span className="plugin-item-head"><strong>{theme.name}</strong><span className="faint">{theme.appearance}</span>{theme.backdrop && <span className="faint">backdrop: {theme.backdrop}</span>}</span></li>
        ))}
      </Section>
      <Section title="Profiles" count={contents.profiles.length}>
        {contents.profiles.map((profile) => <li key={profile.id}><span className="plugin-item-head"><strong>{profile.name}</strong><span className="faint">{profile.id}</span></span></li>)}
      </Section>
      <Section title="Response styles" count={contents.styles.length}>
        {contents.styles.map((style) => <li key={style.id}><span className="plugin-item-head"><strong>{style.name}</strong><span className="faint">{style.id}</span></span></li>)}
      </Section>
      <Section title="Skills" count={contents.skills.length}>
        {contents.skills.map((skill) => <li key={skill.name}><span className="plugin-item-head"><strong>{skill.name}</strong>{skill.description && <span className="faint">{skill.description}</span>}</span></li>)}
      </Section>
    </div>
  );
}

export function PluginProblems({ problems }: { problems: PluginProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="plugin-problems">
      {problems.map((problem, index) => (
        <li key={index} data-severity={problem.severity}>
          <span className="plugin-problem-where">{[problem.file, problem.key].filter(Boolean).join(" · ") || "capsule-plugin.json"}</span>
          <span>{problem.message}</span>
        </li>
      ))}
    </ul>
  );
}

export type OptionDraft = Record<string, PluginOptionValue | null | undefined>;

/** A form for a plugin's typed options. A secret shows only whether it is saved; typing replaces it. */
export function PluginOptionsForm({ options, draft, current, disabled, onChange }: {
  options: Array<PluginOption & { value?: PluginOptionValue; set?: boolean }>;
  draft: OptionDraft;
  current?: boolean;
  disabled?: boolean;
  onChange: (key: string, value: PluginOptionValue | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="plugin-options">
      {options.map((option) => {
        const id = `plugin-option-${option.key}`;
        const value = option.key in draft ? draft[option.key] : option.value ?? option.default;
        const label = <label htmlFor={id}>{option.title}{option.required && <span className="faint"> required</span>}</label>;
        const hint = option.description ? <p className="plugin-option-hint">{option.description}</p> : null;
        if (option.type === "boolean") {
          return (
            <div key={option.key} className="plugin-option plugin-option-inline">
              <div>{label}{hint}</div>
              <Switch label={option.title} checked={value === true} disabled={disabled} onChange={(next) => onChange(option.key, next)} />
            </div>
          );
        }
        return (
          <div key={option.key} className="plugin-option">
            {label}
            {option.type === "enum" ? (
              <select id={id} className="field-select" value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(event) => onChange(option.key, event.target.value)}>
                {value === undefined && <option value="">Choose…</option>}
                {option.options?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            ) : (
              <input
                id={id}
                type={option.type === "secret" ? "password" : option.type === "number" ? "number" : "text"}
                className={option.type === "path" ? "plugin-option-path" : undefined}
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                value={option.type === "secret" ? (typeof draft[option.key] === "string" ? (draft[option.key] as string) : "") : value === undefined || value === null ? "" : String(value)}
                placeholder={option.type === "secret" ? (current && option.set ? "Saved in the Keychain. Type to replace." : "Kept in the Keychain") : option.type === "path" ? "/path/to/file" : undefined}
                onChange={(event) => onChange(option.key, event.target.value)}
              />
            )}
            {hint}
          </div>
        );
      })}
    </div>
  );
}

/** Draft values ready to send: blank text clears nothing on install, and numbers stay as typed for main to check. */
export function draftValues(draft: OptionDraft): Record<string, PluginOptionValue> {
  return Object.fromEntries(Object.entries(draft).filter((entry): entry is [string, PluginOptionValue] => entry[1] !== undefined && entry[1] !== null && entry[1] !== ""));
}
