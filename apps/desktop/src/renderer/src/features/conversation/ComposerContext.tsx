import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  contextSource,
  commandToMarkdown,
  diagnosticsToMarkdown,
  diffToMarkdown,
  fillTemplate,
  hostLabel,
  resolvedContext,
  searchSessionTitles,
  templateVariables,
  threadToMarkdown,
  urlToMarkdown,
  type ChatMessage,
  type ContextAttachment,
  type ContextKind,
  type MessageAttachment,
  type PromptTemplate,
  type ResolvedContext,
  type Session,
} from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { AlertTriangleIcon, BookmarkIcon, DiffIcon, GlobeIcon, MessageSquareIcon, TerminalIcon, XIcon, MousePointerClickIcon } from "../shell/icons";
import { ComposerMenu, type SuggestItem } from "./ComposerMenu";
import "./composer-context.css";

export const CONTEXT_ICONS: Record<ContextKind, (size: number) => ReactNode> = {
  thread: (size) => <MessageSquareIcon size={size} />,
  diff: (size) => <DiffIcon size={size} />,
  diagnostics: (size) => <AlertTriangleIcon size={size} />,
  url: (size) => <GlobeIcon size={size} />,
  selection: (size) => <BookmarkIcon size={size} />,
  command: (size) => <TerminalIcon size={size} />,
  element: (size) => <MousePointerClickIcon size={size} />,
};

export interface PendingContext {
  id: string;
  kind: ContextKind;
  label: string;
  error?: string;
  action?: { label: string; run: () => void };
}

type Outcome = ResolvedContext | { error: string; action?: PendingContext["action"] };

/**
 * Resolves `@` sources and `!` commands into attachments, and tracks the ones
 * still running or failed so the composer can show a chip for each. Work that
 * finishes after the user moved to another conversation is dropped by the
 * workspace's draft scope, so a slow page never lands in the wrong thread.
 */
export function useContextResolver() {
  const workspace = useWorkspace();
  const { api, projectId, session, projects, attachContext, setView } = workspace;
  const [pending, setPending] = useState<PendingContext[]>([]);
  const dismissed = useRef(new Set<string>());
  useEffect(() => { setPending((current) => { for (const item of current) dismissed.current.add(item.id); return []; }); }, [projectId, session?.id]);

  function dismiss(id: string) {
    dismissed.current.add(id);
    setPending((current) => current.filter((item) => item.id !== id));
  }

  async function track(kind: ContextKind, label: string, work: () => Promise<Outcome>): Promise<boolean> {
    const id = crypto.randomUUID();
    setPending((current) => [...current, { id, kind, label }]);
    let outcome: Outcome;
    try { outcome = await work(); } catch (error) { outcome = { error: formatUserError(error) }; }
    if (dismissed.current.has(id)) return false;
    if ("error" in outcome) {
      const failed = outcome;
      setPending((current) => current.map((item) => item.id === id ? { ...item, error: failed.error, ...(failed.action ? { action: failed.action } : {}) } : item));
      return false;
    }
    const attached = await attachContext(outcome);
    dismiss(id);
    return attached;
  }

  function requireProject(): string {
    if (!projectId) throw new Error("Open a project first.");
    return projectId;
  }

  return {
    pending,
    dismiss,
    attachThread: (thread: Session) => track("thread", thread.title, async () => {
      const messages = await api.listMessages(thread.id) as ChatMessage[];
      if (!messages.some((message) => message.role === "user")) return { error: `“${thread.title}” has no messages yet.` };
      const project = projects.find((item) => item.id === thread.projectId)?.name;
      return resolvedContext("thread", thread.title, threadToMarkdown({ title: thread.title, ...(project ? { project } : {}) }, messages), project);
    }),
    attachDiff: (scope: "branch" | "uncommitted") => track("diff", scope === "branch" ? "Branch" : "Uncommitted", async () => {
      const diff = await api.gitScopedDiff(requireProject(), scope, undefined, session?.id);
      if (!diff.patch.trim()) return { error: scope === "branch" ? `No changes on this branch${diff.base ? ` against ${diff.base}` : ""}.` : "No uncommitted changes." };
      const label = scope === "branch" ? `Branch${diff.base ? ` vs ${diff.base}` : ""}` : "Uncommitted";
      return resolvedContext("diff", label, diffToMarkdown({ scope, patch: diff.patch, ...(diff.base ? { base: diff.base } : {}) }));
    }),
    attachDiagnostics: () => track("diagnostics", "Running the project's check…", async () => {
      const result = await api.runDiagnostics(requireProject(), session?.id);
      if (result.status === "none") {
        return { error: "No check command found.", action: { label: "Project actions", run: () => setView("project") } };
      }
      const verdict = result.exitCode === 0 ? "passed" : `exit ${result.exitCode}`;
      return resolvedContext("diagnostics", `${result.check.name} · ${verdict}`, diagnosticsToMarkdown(result), result.check.command);
    }),
    attachUrl: (url: string) => track("url", hostLabel(url.includes("://") ? url : `https://${url}`) ?? url, async () => {
      const page = await api.fetchUrlContext(url);
      return resolvedContext("url", page.title || hostLabel(page.url) || page.url, urlToMarkdown(page), page.url);
    }),
    runCommand: (command: string) => track("command", command, async () => {
      const result = await api.runComposerCommand(requireProject(), command, session?.id);
      return resolvedContext("command", `${command} · exit ${result.exitCode}`, commandToMarkdown(result), `Exit code ${result.exitCode}`);
    }),
  };
}

export type ContextResolver = ReturnType<typeof useContextResolver>;

/** A context attachment: what it is, a way to read it, and a way to drop it. */
export function ContextChip({ attachment, context, onRemove }: { attachment: MessageAttachment; context: ContextAttachment; onRemove: () => void }) {
  const [open, setOpen] = useState<"hover" | "pinned">();
  const previewId = useId();
  const chip = useRef<HTMLSpanElement>(null);
  const source = contextSource(context.kind);
  useEffect(() => {
    if (open !== "pinned") return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node && chip.current?.contains(event.target))) setOpen(undefined); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <span ref={chip} className="composer-attachment composer-context-chip" data-kind={context.kind}
      onMouseEnter={() => setOpen((value) => value ?? "hover")} onMouseLeave={() => setOpen((value) => value === "hover" ? undefined : value)}>
      <button type="button" className="composer-context-open" aria-expanded={Boolean(open)} aria-controls={previewId}
        aria-label={`Preview ${source.label.toLowerCase()}: ${context.label}`}
        onClick={() => setOpen((value) => value === "pinned" ? undefined : "pinned")}
        onFocus={() => setOpen((value) => value ?? "hover")} onBlur={() => setOpen((value) => value === "hover" ? undefined : value)}
        onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(undefined); } }}>
        {CONTEXT_ICONS[context.kind](12)}
        <span className="composer-context-kind">{source.label}</span>
        <span className="composer-context-label">{context.label}</span>
      </button>
      <button type="button" aria-label={`Remove ${context.label}`} onClick={onRemove}><XIcon size={10} /></button>
      {open && <div className="composer-context-preview" id={previewId} role="tooltip">
        <div className="composer-context-preview-head">
          <span>{source.label}</span>
          <small title={context.detail ?? attachment.name}>{context.detail ?? attachment.name}</small>
        </div>
        <pre>{context.excerpt}{attachment.size > context.excerpt.length ? "\n…" : ""}</pre>
        <div className="composer-context-preview-foot">{formatSize(attachment.size)} attached</div>
      </div>}
    </span>
  );
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PendingChip({ item, onDismiss }: { item: PendingContext; onDismiss: () => void }) {
  const source = contextSource(item.kind);
  return (
    <span className={`composer-attachment composer-context-chip ${item.error ? "is-error" : "is-loading"}`} data-kind={item.kind}
      role={item.error ? "alert" : "status"} title={item.error ?? `Attaching ${source.label.toLowerCase()}`}>
      {item.error ? <AlertTriangleIcon size={12} /> : <span className="composer-context-spinner" aria-hidden />}
      <span className="composer-context-kind">{source.label}</span>
      <span className="composer-context-label">{item.error ?? item.label}</span>
      {item.action && <button type="button" className="composer-context-action" onClick={() => { item.action!.run(); onDismiss(); }}>{item.action.label}</button>}
      <button type="button" aria-label={item.error ? "Dismiss" : `Stop waiting for ${item.label}`} onClick={onDismiss}><XIcon size={10} /></button>
    </span>
  );
}

export type ContextPickerKind = "thread" | "diff" | "url";

/** The second step of `@thread`, `@diff` and `@url`: choose which conversation, which diff, which page. */
export function ContextPicker({ kind, resolver, onClose }: { kind: ContextPickerKind; resolver: ContextResolver; onClose: () => void }) {
  const { sessions, session, projectId, projects } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const menuId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setIndex(0); }, [query]);

  const items = useMemo<SuggestItem[]>(() => {
    if (kind === "diff") {
      return [
        { id: "branch", label: "Branch changes", detail: "Everything since this branch left the default branch", run: () => void resolver.attachDiff("branch") },
        { id: "uncommitted", label: "Uncommitted changes", detail: "Staged and unstaged changes against the last commit", run: () => void resolver.attachDiff("uncommitted") },
      ].filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
    }
    if (kind === "url") {
      const address = query.trim();
      return address ? [{ id: "fetch", label: `Fetch ${address}`, detail: "Readable text, up to 200 KB", run: () => void resolver.attachUrl(address) }] : [];
    }
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const others = sessions.filter((item) => item.id !== session?.id && item.state === "active");
    const ordered = [...others.filter((item) => item.projectId === projectId), ...others.filter((item) => item.projectId !== projectId)];
    return searchSessionTitles(ordered, query).slice(0, 40).map((item) => ({
      id: item.id, label: item.title,
      detail: item.projectId === projectId ? "This project" : names.get(item.projectId),
      icon: <MessageSquareIcon size={14} />,
      run: () => void resolver.attachThread(item),
    }));
  }, [kind, projectId, projects, query, resolver, session?.id, sessions]);

  function pick(item: SuggestItem | undefined) {
    if (!item) return;
    void item.run?.();
    onClose();
  }

  const title = kind === "thread" ? "Attach a conversation" : kind === "diff" ? "Attach a diff" : "Attach a web page";
  return (
    <div className="composer-context-picker" data-picker={kind}>
      <div className="composer-context-tabs">
        <span className="composer-context-title">{CONTEXT_ICONS[kind](13)}{title}</span>
        <button type="button" onClick={onClose} aria-label="Close context picker"><XIcon size={14} /></button>
      </div>
      <input ref={input} autoFocus value={query} aria-label={title}
        placeholder={kind === "thread" ? "Search conversations…" : kind === "diff" ? "Filter…" : "https://example.com/docs or localhost:3000"}
        role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={menuId}
        aria-activedescendant={items[index] ? `${menuId}-${index}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex((current) => Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && items[index])) { event.preventDefault(); pick(items[index]); }
        }} />
      <ComposerMenu id={menuId} items={items} index={index} onHover={setIndex} onPick={pick}
        empty={kind === "thread" ? "No other conversations match." : kind === "diff" ? "No matching diff." : "Type an address. Private-network addresses are refused; type localhost for a server on this computer."} />
    </div>
  );
}

/** Asks for a saved prompt's blanks, then hands back the filled text. */
export function TemplateForm({ template, onCancel, onFill }: { template: PromptTemplate; onCancel: () => void; onFill: (text: string) => void }) {
  const variables = useMemo(() => templateVariables(template.prompt), [template.prompt]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(variables.map((variable) => [variable.name, variable.choices?.[0] ?? ""])));
  const [error, setError] = useState<string>();
  const formId = useId();
  function submit() {
    try { onFill(fillTemplate(template.prompt, values)); }
    catch (cause) { setError(formatUserError(cause)); }
  }
  return (
    <form className="composer-context-picker composer-template-form" aria-label={`Fill in ${template.name}`}
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <div className="composer-context-tabs">
        <span className="composer-context-title">{template.name}</span>
        <button type="button" onClick={onCancel} aria-label="Close prompt form"><XIcon size={14} /></button>
      </div>
      {template.description && <p className="composer-template-description">{template.description}</p>}
      <div className="composer-template-fields">
        {variables.map((variable, position) => (
          <label key={variable.name} htmlFor={`${formId}-${variable.name}`}>
            <span>{variable.name}</span>
            {variable.choices ? (
              <select id={`${formId}-${variable.name}`} autoFocus={position === 0} value={values[variable.name] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}>
                {variable.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            ) : (
              <input id={`${formId}-${variable.name}`} autoFocus={position === 0} value={values[variable.name] ?? ""}
                onChange={(event) => { setError(undefined); setValues((current) => ({ ...current, [variable.name]: event.target.value })); }} />
            )}
          </label>
        ))}
      </div>
      {error && <p className="composer-template-error" role="alert">{error}</p>}
      <div className="composer-template-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="send">Insert prompt</button>
      </div>
    </form>
  );
}
