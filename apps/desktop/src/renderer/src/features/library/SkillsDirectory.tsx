import { useState, useMemo, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import type { FileEntry, Skill, SkillCatalogEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { skillMarkdownBody } from "../../lib/skill-markdown";
import { installedCatalogSkill, installSkillWithContent } from "../../lib/skill-install";
import { skillLibraryRows } from "../../lib/skill-library";
import { skillSource } from "../../lib/composer-skills";
import { SkillFiles } from "../../lib/skill-files";
import { formatUserError } from "../../lib/errors";
import { MessageBody } from "../conversation/MessageBody";
import {
  SearchIcon,
  XIcon,
  CheckIcon,
  RefreshIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
} from "../shell/icons";

type Tab = "installed" | "browse";
type DetailTab = "instructions" | "source" | "files";

const HOST_ONLY = "Install and remove skills on the computer running Capsule.";

/** Compact a count for a badge: 12480 -> "12.5k". */
function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/**
 * Build an installable Skill from a catalog entry. Fields the catalog does not
 * carry are left off rather than filled with a plausible-looking default.
 *
 * `content` is what actually does the work: a turn injects the active skill as
 * `[Active Skill: name]` followed by this text, so a skill stored without it is
 * inert. Catalog entries therefore have to carry their SKILL.md, which the
 * installer fetches before saving.
 */
function skillFromCatalog(entry: SkillCatalogEntry, content?: string): Skill {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? "",
    source: entry.source,
    status: "available",
    requirements: [],
    permissions: { filesystem: "approval" },
    url: entry.url,
    tags: ["github"],
    ...(content ? { content } : {}),
  };
}

/** Up and Down move between rows; Down from the search field enters the list. */
function moveRowFocus(event: KeyboardEvent<HTMLElement>, list: HTMLElement | null) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>("[data-skill-row]") ?? []);
  if (rows.length === 0) return;
  event.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
  rows[next]?.focus();
}

function SkillFolderExplorer({ skill }: { skill: Skill }) {
  const { api, projectId, sessionId } = useWorkspace();
  const files = useMemo(() => new SkillFiles(skill.id, {
    listSkillFiles: (id, relative) => api.listSkillFiles(id, relative, projectId, sessionId),
    previewSkillFile: (id, relative) => api.previewSkillFile(id, relative, projectId, sessionId),
  }), [skill.id, api, projectId, sessionId]);
  const { listing, children, expanded, loadingDirectories, directoryErrors, loading,
    preview, selected, previewLoading, previewError, error } = useSyncExternalStore(files.subscribe, files.getSnapshot, files.getSnapshot);
  useEffect(() => { void files.load(); }, [files]);

  function rows(entries: FileEntry[], depth = 0) {
    return entries.map((entry) => {
      const open = expanded.has(entry.path);
      if (entry.type === "directory") {
        return (
          <div className="skill-file-tree-group" key={entry.path}>
            <button
              type="button"
              className="skill-file-tree-row"
              style={{ paddingLeft: `${0.55 + depth * 0.75}rem` }}
              aria-expanded={open}
              onClick={() => void files.toggle(entry.path)}
            >
              {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
              <FolderIcon size={13} />
              <span>{entry.name}</span>
            </button>
            {open ? (
              loadingDirectories.has(entry.path) ? (
                <div className="skill-file-tree-loading" style={{ paddingLeft: `${1.8 + depth * 0.75}rem` }}>
                  Loading…
                </div>
              ) : directoryErrors[entry.path] ? <div className="skill-folder-error" role="alert">
                {directoryErrors[entry.path]} <button type="button" className="ghost" onClick={() => void files.loadDirectory(entry.path)}>Retry</button>
              </div> : children[entry.path]?.length === 0 ? <p className="skill-file-note">Empty folder.</p>
                : rows(children[entry.path] ?? [], depth + 1)
            ) : null}
          </div>
        );
      }
      return (
        <button
          type="button"
          className={`skill-file-tree-row file${selected === entry.path ? " active" : ""}`}
          aria-current={selected === entry.path ? "true" : undefined}
          style={{ paddingLeft: `${1.8 + depth * 0.75}rem` }}
          key={entry.path}
          onClick={() => void files.select(entry.path)}
        >
          <FileIcon size={12} />
          <span>{entry.name}</span>
        </button>
      );
    });
  }

  return (
    <div className="skill-folder-explorer">
      {error ? <div className="skill-folder-error" role="alert">{error} <button type="button" className="ghost" onClick={() => void files.load()}>Retry</button></div> : null}
      <div className="skill-folder-workspace">
        <div className="skill-file-tree">
          {loading ? <p role="status">Loading files…</p> : listing.length > 0 ? rows(listing) : !error && <p>No files available.</p>}
        </div>
        <div className="skill-file-preview">
          {previewLoading ? <p role="status">Loading {selected}…</p> : previewError ? <div className="skill-folder-error" role="alert">
            {previewError} <button type="button" className="ghost" onClick={() => selected && void files.select(selected)}>Retry</button>
          </div> : preview ? (
            <>
              <div className="skill-file-preview-bar">
                <span className="mono">{preview.path}</span>
                <span>{preview.kind === "image" ? preview.mime : preview.language || preview.kind}</span>
              </div>
              {preview.truncated ? <p className="skill-file-note">Showing the first part of this file.</p> : null}
              {preview.kind === "image" && preview.dataUrl ? (
                <div className="skill-file-image-frame">
                  <img src={preview.dataUrl} alt={preview.path} />
                </div>
              ) : null}
              {preview.kind === "text" && preview.language === "markdown" ? (
                <div className="skill-markdown-rendered skill-file-markdown">
                  <MessageBody content={skillMarkdownBody(preview.contents ?? "")} />
                </div>
              ) : null}
              {preview.kind === "text" && preview.language !== "markdown" ? (
                <pre className="mono skill-file-code">{preview.contents}</pre>
              ) : null}
              {preview.kind === "binary" ? <p>{preview.detail ?? "This file cannot be previewed."}</p> : null}
            </>
          ) : (
            <p>Select a file to preview it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillsDirectory() {
  const {
    api,
    skills,
    skillId,
    projectId,
    sessionId,
    view,
    setSkillId,
    setView,
    setBrowserUrl,
    openInspector,
    installSkill,
    uninstallSkill,
    searchSkillCatalog,
    fetchSkillDetail,
    refresh,
  } = useWorkspace();
  const onHost = api?.isDesktop !== false;

  const [tab, setTab] = useState<Tab>("installed");
  const [search, setSearch] = useState("");
  const [inspectSkill, setInspectSkill] = useState<Skill | null>(null);
  const [inspectDocument, setInspectDocument] = useState<{ skill: Skill; content?: string; error?: string }>();
  const [inspectRetry, setInspectRetry] = useState(0);
  const inspectContent = inspectDocument?.skill === inspectSkill ? inspectDocument?.content : undefined;
  const inspectError = inspectDocument?.skill === inspectSkill ? inspectDocument?.error : undefined;
  const inspectLoading = Boolean(inspectSkill && inspectDocument?.skill !== inspectSkill);
  const [detailTab, setDetailTab] = useState<DetailTab>("instructions");
  const [directoryResults, setDirectoryResults] = useState<SkillCatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryPartial, setDirectoryPartial] = useState<string[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [skillsShConnected, setSkillsShConnected] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string>();
  const [rescanning, setRescanning] = useState(false);
  const mutationPending = useRef(false);
  const selection = useRef({ inspectSkill, projectId, sessionId, view, skillId });
  selection.current = { inspectSkill, projectId, sessionId, view, skillId };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const list = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // The catalog is fetched live: GitHub always, plus skills.sh when a token is
  // configured. An empty query browses everything; typing filters what was
  // fetched. Bumping refreshToken forces a refetch past the cache.
  useEffect(() => {
    if (tab !== "browse" || !onHost) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const page = await searchSkillCatalog(search.trim(), refreshToken > 0);
        if (cancelled) return;
        setDirectoryResults(page.entries);
        setDirectoryPartial(page.errors);
        setSkillsShConnected(Boolean(page.skillsShConnected));
        setFetchedAt(page.fetchedAt);
        setDirectoryError(null);
      } catch (error) {
        if (cancelled) return;
        setDirectoryError(formatUserError(error));
      } finally {
        if (!cancelled) {
          setSearching(false);
          setDirectoryLoaded(true);
        }
      }
    }, directoryLoaded ? 120 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // directoryLoaded only tunes the debounce; re-running on it would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tab, searchSkillCatalog, refreshToken, onHost]);

  useEffect(() => {
    let cancelled = false;
    if (!inspectSkill) return;
    setMutationError(undefined);
    if (inspectSkill.content?.trim()) {
      setInspectDocument({ skill: inspectSkill, content: inspectSkill.content });
      return;
    }
    setInspectDocument(undefined);
    void fetchSkillDetail(inspectSkill.id).then((content) => {
      if (!cancelled) setInspectDocument({ skill: inspectSkill, content,
        error: content?.trim() ? undefined : "SKILL.md could not be loaded for this skill." });
    }).catch((error: unknown) => {
      if (!cancelled) setInspectDocument({ skill: inspectSkill, error: formatUserError(error) });
    });
    return () => { cancelled = true; };
  }, [inspectSkill, fetchSkillDetail, inspectRetry]);

  const opened = Boolean(inspectSkill);
  useEffect(() => {
    if (!opened) return;
    dialog.current?.focus();
    return () => { opener.current?.focus(); };
  }, [opened]);

  const rows = useMemo(() => skillLibraryRows(skills, search), [skills, search]);
  const installedCount = useMemo(() => skills.filter((skill) => skill.status === "installed").length, [skills]);
  const skillsShFailed = directoryPartial.some((reason) => /skills\.sh/i.test(reason));

  function inspect(skill: Skill) {
    opener.current = document.activeElement as HTMLElement | null;
    setDetailTab("instructions");
    setInspectSkill(skill);
  }

  async function rescan() {
    setRescanning(true);
    try {
      await refresh();
    } catch (error) {
      setMutationError(formatUserError(error));
    } finally {
      if (mounted.current) setRescanning(false);
    }
  }

  async function mutate(key: string, work: () => Promise<void>) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setInstalling(key); setMutationError(undefined); setImportNotice(null);
    try {
      await work();
    } catch (error) {
      if (mounted.current) setMutationError(formatUserError(error));
    } finally {
      mutationPending.current = false;
      if (mounted.current) setInstalling(null);
    }
  }

  /**
   * Install a catalog skill, fetching its SKILL.md first. Without the document
   * the skill has nothing to inject; refusing to save it is better than saving
   * something that silently does nothing.
   */
  async function installRequestedSkill(skill: Skill, attach = false) {
    const owner = selection.current;
    await mutate(skill.id, async () => {
      const saved = await installSkillWithContent(skill, { fetchSkillDetail, installSkill });
      if (!mounted.current) return;
      setImportNotice(`Installed ${saved.name}.`);
      const current = selection.current;
      if (current.inspectSkill !== owner.inspectSkill) return;
      if (owner.inspectSkill?.id === skill.id) setInspectSkill(saved);
      if (attach && current.projectId === owner.projectId && current.sessionId === owner.sessionId && current.view === owner.view) {
        setSkillId(saved.id); setInspectSkill(null); setView("chat");
      }
    });
  }

  function attachSkill(skill: Skill) {
    if (mutationPending.current) return;
    setSkillId(skill.id);
    setInspectSkill(null);
    setView("chat");
  }

  async function removeSkill(skill: Skill) {
    await mutate(`remove:${skill.id}`, async () => {
      await uninstallSkill(skill.id);
      if (!mounted.current) return;
      if (selection.current.skillId === skill.id) setSkillId(undefined);
      setInspectSkill((current) => current?.id === skill.id ? { ...current, status: "available" } : current);
      setImportNotice(`Uninstalled ${skill.name}.`);
    });
  }

  function openInCapsuleBrowser(url: string) {
    setBrowserUrl(url);
    openInspector("browser");
  }

  const attached = inspectSkill && skillId === inspectSkill.id;
  const folder = inspectSkill?.location?.replace(/[\\/]SKILL\.md$/i, "");
  const home = api?.homeDir;
  const shownFolder = folder && home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;

  return (
    <div className="skills-directory">
      <div className="skills-header">
        <div className="skills-header-text">
          <h2>Skills</h2>
          <p>Type <kbd>$</kbd> in the composer to attach one to your next message.</p>
        </div>
        <div className="skills-search-bar">
          <SearchIcon size={16} className="skills-search-icon" />
          <input
            type="search"
            className="skills-search-input"
            aria-label={tab === "installed" ? "Search installed skills" : "Search GitHub skills"}
            placeholder={tab === "installed" ? "Search installed skills" : "Search GitHub skills"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(event) => moveRowFocus(event, list.current)}
          />
          {search && (
            <button type="button" className="skills-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              <XIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {importNotice && <div className="skills-notice" role="status">{importNotice}</div>}
      {mutationError && !inspectSkill && <p className="skill-folder-error" role="alert">{mutationError}</p>}

      <div className="skills-tabs">
        <div role="tablist" aria-label="Skills">
          <button type="button" role="tab" aria-selected={tab === "installed"} className={`skills-tab ${tab === "installed" ? "active" : ""}`} onClick={() => setTab("installed")}>
            Installed <span className="tab-count">{installedCount}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "browse"} className={`skills-tab ${tab === "browse" ? "active" : ""}`} onClick={() => setTab("browse")}>
            Browse GitHub
          </button>
        </div>
        {tab === "installed" ? (
          <button type="button" className="ghost icon skills-tab-action" title="Scan for new skills" aria-label="Scan for new skills" disabled={rescanning} onClick={() => void rescan()}>
            <RefreshIcon size={13} className={rescanning ? "spin" : undefined} />
          </button>
        ) : onHost ? (
          <span className="skills-source-state">
            {skillsShConnected && !skillsShFailed ? "GitHub and skills.sh" : "GitHub"}
            {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : null}
            <button type="button" className="ghost icon skills-tab-action" title="Fetch the catalog again" aria-label="Fetch the catalog again" disabled={searching} onClick={() => setRefreshToken((value) => value + 1)}>
              <RefreshIcon size={13} className={searching ? "spin" : undefined} />
            </button>
          </span>
        ) : null}
      </div>

      {tab === "installed" && (
        <div className="installed-skill-list" ref={list} onKeyDown={(event) => moveRowFocus(event, list.current)}>
          {rows.length === 0 ? (
            <p className="skills-empty compact">
              {search.trim()
                ? `No installed skill matches "${search.trim()}".`
                : "No skills found. Put a folder with a SKILL.md in ~/.agents/skills or this project's .claude/skills, or install one from Browse GitHub."}
            </p>
          ) : rows.map(({ skill, source }) => (
            <button type="button" data-skill-row className="installed-skill-row" key={skill.id} onClick={() => inspect(skill)}>
              <span className="installed-skill-name">{skill.name}</span>
              <span className="installed-skill-description">{skill.description || "No description in SKILL.md."}</span>
              {source ? <span className="installed-skill-source">{source}</span> : null}
              {skillId === skill.id ? <span className="installed-skill-attached" title="Attached to your next message"><CheckIcon size={12} />Attached</span> : null}
            </button>
          ))}
        </div>
      )}

      {tab === "browse" && !onHost && <p className="skills-empty compact">{HOST_ONLY}</p>}
      {tab === "browse" && onHost && (
        <>
          {directoryPartial.length > 0 && (
            <details className="skills-inline-warning">
              <summary>
                {skillsShFailed
                  ? "skills.sh is unavailable. Showing GitHub results."
                  : `${directoryPartial.length} catalog source${directoryPartial.length === 1 ? "" : "s"} did not refresh`}
              </summary>
              <p>{directoryPartial.join("; ")}</p>
            </details>
          )}
          <div className="skill-catalog-list" ref={list} onKeyDown={(event) => moveRowFocus(event, list.current)}>
            {searching && directoryResults.length === 0 && (
              <div className="skills-loading" role="status">Loading skills from GitHub…</div>
            )}
            {!searching && directoryError && (
              <div className="skills-empty compact" role="alert">
                <p>Could not reach GitHub: {directoryError}</p>
                <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>
                  Retry
                </button>
              </div>
            )}
            {!searching && !directoryError && directoryResults.length === 0 && (
              <div className="skills-empty compact">
                {search.trim() ? `No catalog skill matches "${search.trim()}".` : "No skills were returned."}
              </div>
            )}
            {directoryResults.map((result) => {
              const installed = installedCatalogSkill(result, skills);
              const metric =
                typeof result.installs === "number"
                  ? `${compactCount(result.installs)} installs`
                  : typeof result.stars === "number"
                    ? `${compactCount(result.stars)} ★`
                    : undefined;
              return (
                <div className="skill-catalog-row" key={result.id}>
                  <button type="button" data-skill-row className="skill-catalog-main" onClick={() => inspect(installed ?? skillFromCatalog(result))}>
                    <span className="skill-catalog-name">{result.name}</span>
                    <span className={`skill-catalog-description${result.description ? "" : " missing"}`}>
                      {result.description || "No description in SKILL.md."}
                    </span>
                    <span className="skill-catalog-metric" title={result.source}>{result.source}{metric ? ` · ${metric}` : ""}</span>
                  </button>
                  {installed ? (
                    <span className="installed-skill-attached"><CheckIcon size={12} />Installed</span>
                  ) : (
                    <button
                      type="button"
                      className="skill-catalog-install"
                      disabled={installing !== null}
                      onClick={() => void installRequestedSkill(skillFromCatalog(result))}
                    >
                      <PlusIcon size={13} />
                      {installing === result.id ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {inspectSkill && (
        <div className="skill-inspect-overlay" onClick={() => setInspectSkill(null)}>
          <div
            className="skill-inspect-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-inspect-title"
            tabIndex={-1}
            ref={dialog}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setInspectSkill(null); } }}
          >
            <div className="skill-inspect-header">
              <div>
                <div className="skill-modal-title-row">
                  <h2 id="skill-inspect-title">{inspectSkill.name}</h2>
                  {inspectSkill.version && <span className="skill-version">v{inspectSkill.version}</span>}
                  {inspectSkill.status !== "installed" ? <span className="skill-status-badge">Not installed</span> : null}
                  {attached ? <span className="skill-status-badge">Attached</span> : null}
                </div>
                <div className="skill-modal-meta">
                  <span>{inspectSkill.status === "installed" ? skillSource(inspectSkill) : inspectSkill.source}</span>
                  {folder ? <span className="mono" title={folder}>{shownFolder}</span> : null}
                  {typeof inspectSkill.installs === "number" && <span>{inspectSkill.installs.toLocaleString()} installs</span>}
                </div>
              </div>
              <button type="button" className="skill-inspect-close" aria-label="Close" onClick={() => setInspectSkill(null)}>
                <XIcon size={18} />
              </button>
            </div>

            <div className="skill-modal-subnav" role="tablist" aria-label="Skill">
              {(["instructions", "source", ...(inspectSkill.status === "installed" ? ["files" as const] : [])] as DetailTab[]).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={detailTab === id} className={`skill-subnav-btn ${detailTab === id ? "active" : ""}`} onClick={() => setDetailTab(id)}>
                  {id === "instructions" ? "Instructions" : id === "source" ? "SKILL.md" : "Files"}
                </button>
              ))}
            </div>

            <div className="skill-inspect-body">
              {mutationError && <p className="skill-folder-error" role="alert">{mutationError}</p>}
              {detailTab !== "files" && inspectError && <div className="skill-folder-error" role="alert">
                {inspectError} <button type="button" className="ghost" onClick={() => setInspectRetry((value) => value + 1)}>Retry</button>
              </div>}
              {detailTab === "instructions" && (
                <div className="skill-inspect-content">
                  {inspectSkill.description ? <p className="skill-modal-desc">{inspectSkill.description}</p> : null}
                  {inspectLoading ? <p className="skills-empty compact" role="status">Loading SKILL.md…</p> : inspectContent ? (
                    <div className="skill-markdown-rendered">
                      <MessageBody content={skillMarkdownBody(inspectContent)} />
                    </div>
                  ) : null}
                </div>
              )}
              {detailTab === "source" && (
                <pre className="mono skill-markdown-pre">{inspectLoading ? "Loading SKILL.md…" : inspectContent ?? ""}</pre>
              )}
              {detailTab === "files" && <SkillFolderExplorer skill={inspectSkill} />}
            </div>

            <div className="skill-inspect-footer">
              <p className="skill-inspect-note">
                {inspectSkill.status === "installed"
                  ? "Capsule sends these instructions with your message, so every agent can follow them."
                  : "Installing saves its SKILL.md in Capsule."}
                {inspectSkill.url ? <> <button type="button" className="skills-link skills-link-button" onClick={() => openInCapsuleBrowser(inspectSkill.url!)}>
                  {inspectSkill.url.startsWith("https://github.com/") ? "View on GitHub" : "View source"}
                </button></> : null}
              </p>
              <div className="skill-inspect-actions">
                {inspectSkill.status === "installed" ? (
                  <>
                    {!inspectSkill.managedExternally && (
                      <button
                        type="button"
                        className="ghost danger-text"
                        disabled={installing !== null || !onHost}
                        title={onHost ? undefined : HOST_ONLY}
                        onClick={() => void removeSkill(inspectSkill)}
                      >
                        {installing === `remove:${inspectSkill.id}` ? "Removing…" : "Uninstall"}
                      </button>
                    )}
                    {attached ? (
                      <button type="button" className="ghost" onClick={() => setSkillId(undefined)}>Remove from message</button>
                    ) : (
                      <button type="button" className="send" disabled={installing !== null} onClick={() => attachSkill(inspectSkill)}>
                        Attach to message
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      disabled={installing !== null || !onHost}
                      title={onHost ? undefined : HOST_ONLY}
                      onClick={() => void installRequestedSkill({ ...inspectSkill, content: inspectContent ?? inspectSkill.content })}
                    >
                      {installing === inspectSkill.id ? "Installing…" : "Install"}
                    </button>
                    <button
                      type="button"
                      className="send"
                      disabled={installing !== null || !onHost}
                      title={onHost ? undefined : HOST_ONLY}
                      onClick={() => void installRequestedSkill({ ...inspectSkill, content: inspectContent ?? inspectSkill.content }, true)}
                    >
                      Install and attach
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
