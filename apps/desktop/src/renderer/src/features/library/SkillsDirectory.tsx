import { useState, useMemo, useEffect, useRef, useSyncExternalStore } from "react";
import type { FileEntry, Skill, SkillPack, SkillCatalogEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { skillMarkdownBody } from "../../lib/skill-markdown";
import { installedCatalogSkill, installSkillWithContent } from "../../lib/skill-install";
import { SkillFiles } from "../../lib/skill-files";
import { formatUserError } from "../../lib/errors";
import { MessageBody } from "../conversation/MessageBody";
import {
  SearchIcon,
  XIcon,
  SparkIcon,
  CopyIcon,
  CheckIcon,
  RefreshIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
} from "../shell/icons";

type TabFilter = "packs" | "installed" | "directory";

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
 * inert — it appears installed, attaches to a conversation, and contributes
 * nothing. Catalog entries therefore have to carry their SKILL.md, which the
 * installer below fetches before saving.
 */
function skillFromCatalog(
  entry: SkillCatalogEntry,
  status: Skill["status"],
  content?: string,
): Skill {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? "",
    source: entry.source,
    status,
    requirements: [],
    permissions: { filesystem: "approval" },
    url: entry.url,
    tags: ["github"],
    ...(content ? { content } : {}),
  };
}

function InstalledSkillGroup({
  title,
  description,
  skills,
  empty,
  skillId,
  installing,
  onInspect,
  onAttach,
}: {
  title: string;
  description: string;
  skills: Skill[];
  empty: string;
  skillId?: string;
  installing: string | null;
  onInspect: (skill: Skill) => void;
  onAttach: (skill: Skill) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleSkills = expanded ? skills : skills.slice(0, 12);

  return (
    <section className="installed-skill-group">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{skills.length}</span>
      </header>
      {skills.length === 0 ? (
        <p className="installed-skills-empty">{empty}</p>
      ) : (
        <div className="installed-skill-list">
          {visibleSkills.map((skill) => (
            <div className="installed-skill-row" key={skill.id}>
              <button type="button" className="installed-skill-main" onClick={() => onInspect(skill)}>
                <span className="installed-skill-name">
                  <b>{skill.name}</b>
                  <i>{skill.source}</i>
                </span>
                <span className="installed-skill-description">
                  {skill.description || "No description in SKILL.md."}
                </span>
              </button>
              <button
                type="button"
                className={`installed-skill-attach${skillId === skill.id ? " attached" : ""}`}
                disabled={installing !== null}
                onClick={() => onAttach(skill)}
              >
                {skillId === skill.id ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                {installing === skill.id ? "Loading…" : skillId === skill.id ? "Attached" : "Attach"}
              </button>
            </div>
          ))}
          {skills.length > 12 ? (
            <button
              type="button"
              className="installed-skills-more"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer" : `Show all ${skills.length}`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SkillFolderExplorer({ skill }: { skill: Skill }) {
  const files = useMemo(() => new SkillFiles(skill.id, window.capsule), [skill.id]);
  const { listing, children, expanded, loadingDirectories, directoryErrors, loading,
    preview, selected, previewLoading, previewError, error } = useSyncExternalStore(files.subscribe, files.getSnapshot, files.getSnapshot);
  const folderPath = skill.location?.replace(/[\\/]SKILL\.md$/i, "");
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
      <div className="skill-folder-heading">
        <div>
          <b>{folderPath ? "Skill folder" : "Stored skill"}</b>
          <span>{folderPath ?? "Capsule library · SKILL.md only"}</span>
        </div>
        <span className="skill-folder-readonly">Read only</span>
      </div>
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
    skills,
    skillPacks,
    skillId,
    projectId,
    sessionId,
    view,
    setSkillId,
    setView,
    setBrowserUrl,
    openInspector,
    installSkill,
    installSkillPack,
    uninstallSkill,
    searchSkillCatalog,
    fetchSkillDetail,
    refresh,
  } = useWorkspace();

  const [tab, setTab] = useState<TabFilter>("installed");
  const [search, setSearch] = useState("");
  const [inspectSkill, setInspectSkill] = useState<Skill | null>(null);
  const [inspectPack, setInspectPack] = useState<SkillPack | null>(null);
  const [inspectDocument, setInspectDocument] = useState<{ skill: Skill; content?: string; error?: string }>();
  const [inspectRetry, setInspectRetry] = useState(0);
  const inspectContent = inspectDocument?.skill === inspectSkill ? inspectDocument?.content : undefined;
  const inspectError = inspectDocument?.skill === inspectSkill ? inspectDocument?.error : undefined;
  const inspectLoading = Boolean(inspectSkill && inspectDocument?.skill !== inspectSkill);
  const [inspectModalTab, setInspectModalTab] = useState<
    "instructions" | "cli" | "source" | "files"
  >("instructions");
  const [directoryResults, setDirectoryResults] = useState<SkillCatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryPartial, setDirectoryPartial] = useState<string[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [skillsShConnected, setSkillsShConnected] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string>();
  const mutationPending = useRef(false);
  const selection = useRef({ inspectSkill, inspectPack, projectId, sessionId, view, skillId });
  selection.current = { inspectSkill, inspectPack, projectId, sessionId, view, skillId };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [refreshingInstalled, setRefreshingInstalled] = useState(false);
  const [showAllCatalog, setShowAllCatalog] = useState(false);

  // The catalog is fetched live: GitHub always, plus skills.sh when a token is
  // configured. An empty query browses everything; typing filters what was
  // fetched. Bumping refreshToken forces a refetch past the cache.
  useEffect(() => {
    if (tab !== "directory") return;
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
        setDirectoryError(error instanceof Error ? error.message : String(error));
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
  }, [search, tab, searchSkillCatalog, refreshToken]);

  // Inspect skill detail content
  useEffect(() => {
    let cancelled = false;
    if (!inspectSkill) return;
    setInspectModalTab("instructions");
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

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (s.status !== "installed") return false;
      if (!query) return true;
      return (
        s.name.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.source.toLowerCase().includes(query) ||
        s.location?.toLowerCase().includes(query) ||
        s.packName?.toLowerCase().includes(query) ||
        s.tags?.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [skills, search]);

  const filteredPacks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skillPacks.filter((p) => {
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.author?.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [skillPacks, search]);

  const installedSkills = filteredSkills.filter((skill) => skill.status === "installed");
  const globalSkills = installedSkills.filter((skill) => skill.managedExternally);
  const capsuleSkills = installedSkills.filter((skill) => !skill.managedExternally);
  const skillsShFailed = directoryPartial.some((reason) => /skills\.sh/i.test(reason));
  const visibleDirectoryResults =
    search.trim() || showAllCatalog ? directoryResults : directoryResults.slice(0, 24);
  const inspectedPackSkills = inspectPack ? skills.filter((skill) => skill.packId === inspectPack.id) : [];
  const inspectedPackInstalled = inspectedPackSkills.length > 0 && inspectedPackSkills.every((skill) => skill.status === "installed");

  async function refreshInstalledSkills() {
    setRefreshingInstalled(true);
    try {
      await refresh();
    } catch (error) {
      setMutationError(formatUserError(error));
    } finally {
      setRefreshingInstalled(false);
    }
  }

  /**
   * Install a catalog skill, fetching its SKILL.md first. Without the document
   * the skill has nothing to inject; refusing to save it is better than saving
   * something that silently does nothing.
   */
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

  async function installPack(pack: SkillPack) {
    await mutate(`pack:${pack.id}`, async () => {
      await installSkillPack(pack.id);
      if (mounted.current) setImportNotice(`Installed pack: ${pack.name}.`);
    });
  }

  function attachSkill(skill: Skill) {
    if (mutationPending.current) return;
    if (!skill.content?.trim()) {
      void installRequestedSkill({ ...skill, content: inspectSkill?.id === skill.id ? inspectContent : undefined }, true);
      return;
    }
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

  async function handleCopyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCmd(text);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {
      // ignore
    }
  }

  function openInCapsuleBrowser(url: string) {
    setBrowserUrl(url);
    openInspector("browser");
  }

  return (
    <div className="skills-directory">
      <div className="skills-header">
        <div className="skills-header-text">
          <div className="skills-title-row">
            <h2>Skills</h2>
            {tab === "directory" && directoryLoaded && !directoryError && (
              <div className="skills-stats-badge">
                <SparkIcon size={14} className="skills-spark-icon" />
                <span>
                  {directoryResults.length} {directoryResults.length === 1 ? "skill" : "skills"}
                  {search.trim() ? " matching" : " from GitHub"}
                </span>
              </div>
            )}
          </div>
          <p>
            Use skills already installed on this Mac, or add more from{" "}
            <button
              type="button"
              className="skills-link skills-link-button"
              onClick={() => openInCapsuleBrowser("https://github.com/topics/agent-skills")}
            >
              GitHub
            </button>
            . Attach one with <code className="mono">$</code> in the composer.
          </p>
        </div>

        {/* Search & Import Bar */}
        <div className="skills-search-bar">
          <SearchIcon size={16} className="skills-search-icon" />
          <input
            type="text"
            className="skills-search-input"
            placeholder="Search skills and packs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="skills-search-clear"
              onClick={() => setSearch("")}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {importNotice && <div className="skills-notice" role="status">{importNotice}</div>}
      {mutationError && !inspectSkill && !inspectPack && <p className="skill-folder-error" role="alert">{mutationError}</p>}

      <div className="skills-tabs">
        <button
          type="button"
          className={`skills-tab ${tab === "installed" ? "active" : ""}`}
          onClick={() => setTab("installed")}
        >
          Installed{" "}
          <span className="tab-count">
            {skills.filter((skill) => skill.status === "installed").length}
          </span>
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === "directory" ? "active" : ""}`}
          onClick={() => setTab("directory")}
        >
          Browse GitHub
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === "packs" ? "active" : ""}`}
          onClick={() => setTab("packs")}
        >
          Packs <span className="tab-count">{skillPacks.length}</span>
        </button>
      </div>

      {tab === "installed" && (
        <div className="installed-skills">
          <div className="installed-skills-toolbar">
            <p>Choose a skill to inspect its guidance, or attach it directly.</p>
            <button
              type="button"
              className="ghost"
              disabled={refreshingInstalled}
              onClick={() => void refreshInstalledSkills()}
            >
              <RefreshIcon size={13} />
              {refreshingInstalled ? "Scanning…" : "Scan again"}
            </button>
          </div>

          <InstalledSkillGroup
            title="On this Mac"
            description="Read from global Agent Skills, Codex, Claude Code, and OpenCode folders. Capsule does not move or remove these files."
            skills={globalSkills}
            empty="No matching global skills were found. Global installs appear here automatically."
            skillId={skillId}
            installing={installing}
            onInspect={setInspectSkill}
            onAttach={attachSkill}
          />

          <InstalledSkillGroup
            title="Capsule library"
            description="Skills and packs installed through Capsule."
            skills={capsuleSkills}
            empty="No matching Capsule-managed skills are installed."
            skillId={skillId}
            installing={installing}
            onInspect={setInspectSkill}
            onAttach={attachSkill}
          />
        </div>
      )}

      {/* Packs View */}
      {tab === "packs" && (
        <div className="skills-compact-section">
          <div className="skills-section-intro">
            <p>Install a curated group at once, or open it to inspect every included skill.</p>
          </div>
          <div className="skill-pack-list">
            {filteredPacks.length === 0 ? (
              <div className="skills-empty compact">
                {search.trim()
                  ? `No skill pack matches "${search.trim()}".`
                  : "No skill packs are bundled."}
              </div>
            ) : null}
            {filteredPacks.map((pack) => {
              const packSkills = skills.filter((skill) => skill.packId === pack.id);
              const allInstalled =
                packSkills.length > 0 && packSkills.every((skill) => skill.status === "installed");
              const included = packSkills.map((skill) => skill.name).join(" · ");
              return (
                <div className="skill-pack-row" key={pack.id}>
                  <button type="button" className="skill-pack-main" onClick={() => setInspectPack(pack)}>
                    <span className="skill-pack-name">
                      <b>{pack.name}</b>
                      {pack.author ? <i>by {pack.author}</i> : null}
                    </span>
                    <span className="skill-pack-description">{pack.description}</span>
                    <span className="skill-pack-summary">
                      {pack.skillCount || packSkills.length} skills
                      {included ? ` · ${included}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`installed-skill-attach${allInstalled ? " attached" : ""}`}
                    disabled={allInstalled || installing !== null}
                    onClick={() => void installPack(pack)}
                  >
                    {allInstalled ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                    {installing === `pack:${pack.id}` ? "Installing…" : allInstalled ? "Installed" : "Install"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Directory tab — live from the source repositories on GitHub. */}
      {tab === "directory" && (
        <>
          <div className="skills-source-bar">
            <span className="skills-source-state">
              <span
                className={`skills-source-dot ${directoryResults.length > 0 ? "on" : "off"}`}
                aria-hidden
              />
              {skillsShConnected && !skillsShFailed
                ? "GitHub + skills.sh"
                : "GitHub catalog"}
              {fetchedAt ? (
                <span className="faint">
                  {" · fetched "}
                  {new Date(fetchedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="ghost"
              disabled={searching}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              {searching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {directoryPartial.length > 0 && (
            <details className="skills-inline-warning">
              <summary>
                {skillsShFailed
                  ? "skills.sh is unavailable — showing GitHub results"
                  : `${directoryPartial.length} catalog source${directoryPartial.length === 1 ? "" : "s"} did not refresh`}
              </summary>
              <p>{directoryPartial.join("; ")}</p>
            </details>
          )}
          <div className="skill-catalog-list">
            {searching && directoryResults.length === 0 && (
              <div className="skills-loading">Loading skills from GitHub…</div>
            )}
            {!searching && directoryError && (
              <div className="skills-empty">
                <p>Could not reach GitHub: {directoryError}</p>
                <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>
                  Retry
                </button>
              </div>
            )}
            {!searching && !directoryError && directoryResults.length === 0 && (
              <div className="skills-empty">
                {search.trim()
                  ? `No catalog skill matches "${search.trim()}".`
                  : "No skills were returned."}
              </div>
            )}
            {visibleDirectoryResults.map((result) => {
              const installed = installedCatalogSkill(result, skills);
              const isInstalled = Boolean(installed);
              const metric =
                typeof result.installs === "number"
                  ? `${compactCount(result.installs)} installs`
                  : typeof result.stars === "number"
                    ? `${compactCount(result.stars)} ★`
                    : undefined;
              return (
                <div className="skill-catalog-row" key={result.id}>
                  <button
                    type="button"
                    className="skill-catalog-main"
                    onClick={() =>
                      setInspectSkill(
                        installed ?? skillFromCatalog(result, "available"),
                      )
                    }
                  >
                    <span className="skill-catalog-name">
                      <b>{result.name}</b>
                      <i>{result.source}</i>
                    </span>
                    <span className={`skill-catalog-description${result.description ? "" : " missing"}`}>
                      {result.description || "No description in SKILL.md."}
                    </span>
                    {metric ? <span className="skill-catalog-metric">{metric}</span> : null}
                  </button>
                  <button
                    type="button"
                    className={`installed-skill-attach${isInstalled ? " attached" : ""}`}
                    disabled={isInstalled || installing !== null}
                    onClick={() => void installRequestedSkill(skillFromCatalog(result, "available"))}
                  >
                    {isInstalled ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                    {installing === result.id ? "Installing…" : isInstalled ? "Installed" : "Install"}
                  </button>
                </div>
              );
            })}
            {!search.trim() && directoryResults.length > visibleDirectoryResults.length ? (
              <button type="button" className="installed-skills-more" onClick={() => setShowAllCatalog(true)}>
                Show all {directoryResults.length} skills
              </button>
            ) : null}
            {!search.trim() && showAllCatalog && directoryResults.length > 24 ? (
              <button type="button" className="installed-skills-more" onClick={() => setShowAllCatalog(false)}>
                Show fewer
              </button>
            ) : null}
          </div>
        </>
      )}

      {/* Skill Inspect / Detail Modal */}
      {inspectSkill && (
        <div
          className="skill-inspect-overlay"
          onClick={() => setInspectSkill(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="skill-inspect-modal" onClick={(e) => e.stopPropagation()}>
            <div className="skill-inspect-header">
              <div>
                <div className="skill-modal-title-row">
                  <h2>{inspectSkill.name}</h2>
                  {inspectSkill.version && <span className="skill-version">v{inspectSkill.version}</span>}
                  <span className={`skill-status-badge ${inspectSkill.status}`}>
                    {inspectSkill.status}
                  </span>
                </div>
                <div className="skill-modal-meta">
                  <span>Source: {inspectSkill.source}</span>
                  {inspectSkill.packName && <span> · Pack: {inspectSkill.packName}</span>}
                  {typeof inspectSkill.installs === "number" && (
                    <span> · {inspectSkill.installs.toLocaleString()} installs</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="skill-inspect-close"
                onClick={() => setInspectSkill(null)}
              >
                <XIcon size={18} />
              </button>
            </div>

            <div className="skill-modal-subnav">
              <button
                type="button"
                className={`skill-subnav-btn ${inspectModalTab === "instructions" ? "active" : ""}`}
                onClick={() => setInspectModalTab("instructions")}
              >
                SKILL.md Guidance
              </button>
              <button
                type="button"
                className={`skill-subnav-btn ${inspectModalTab === "source" ? "active" : ""}`}
                onClick={() => setInspectModalTab("source")}
              >
                Source
              </button>
              {inspectSkill.status === "installed" ? (
                <button
                  type="button"
                  className={`skill-subnav-btn ${inspectModalTab === "files" ? "active" : ""}`}
                  onClick={() => setInspectModalTab("files")}
                >
                  Files
                </button>
              ) : null}
              <button
                type="button"
                className={`skill-subnav-btn ${inspectModalTab === "cli" ? "active" : ""}`}
                onClick={() => setInspectModalTab("cli")}
              >
                {inspectSkill.managedExternally ? "On disk" : "CLI Command"}
              </button>
            </div>

            <div className="skill-inspect-body">
              {mutationError && <p className="skill-folder-error" role="alert">{mutationError}</p>}
              {(inspectModalTab === "instructions" || inspectModalTab === "source") && inspectError && <div className="skill-folder-error" role="alert">
                {inspectError} <button type="button" className="ghost" onClick={() => setInspectRetry((value) => value + 1)}>Retry</button>
              </div>}
              {inspectModalTab === "instructions" && (
                <div className="skill-inspect-content">
                  <p className="skill-modal-desc">{inspectSkill.description}</p>
                  {inspectLoading ? <p className="skills-empty" role="status">Loading SKILL.md…</p> : inspectContent ? (
                    <div className="skill-markdown-rendered">
                      <MessageBody content={skillMarkdownBody(inspectContent)} />
                    </div>
                  ) : null}
                </div>
              )}

              {inspectModalTab === "source" && (
                <pre className="mono skill-markdown-pre">
                  {inspectLoading ? "Loading SKILL.md…" : inspectContent ?? ""}
                </pre>
              )}

              {inspectModalTab === "files" && <SkillFolderExplorer skill={inspectSkill} />}

              {inspectModalTab === "cli" && (
                <div className="skill-cli-view">
                  <p>
                    {inspectSkill.managedExternally
                      ? "This skill is managed by another agent CLI:"
                      : "Install via the open skills CLI:"}
                  </p>
                  <div className="pack-card-cli-row">
                    <code className="pack-cmd mono">
                      {inspectSkill.managedExternally
                        ? inspectSkill.location
                        : inspectSkill.url
                          ? `npx skills add ${inspectSkill.url}`
                          : `npx skills add ${inspectSkill.id}`}
                    </code>
                    <button
                      type="button"
                      className="pack-cmd-copy"
                      onClick={() =>
                        void handleCopyText(
                          inspectSkill.managedExternally
                            ? inspectSkill.location ?? ""
                            : inspectSkill.url
                              ? `npx skills add ${inspectSkill.url}`
                              : `npx skills add ${inspectSkill.id}`,
                        )
                      }
                    >
                      {copiedCmd ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="skill-inspect-footer">
              {inspectSkill.url && (
                <button
                  type="button"
                  className="skills-link skills-link-button"
                  onClick={() => openInCapsuleBrowser(inspectSkill.url!)}
                >
                  {inspectSkill.url.startsWith("https://github.com/") ? "View on GitHub ↗" : "View source ↗"}
                </button>
              )}
              <div className="skill-inspect-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setInspectSkill(null)}
                >
                  Close
                </button>
                {inspectSkill.status === "installed" ? (
                  <>
                    {!inspectSkill.managedExternally && (
                      <button
                        type="button"
                        className="ghost danger-text"
                        disabled={installing !== null}
                        onClick={() => void removeSkill(inspectSkill)}
                      >
                        {installing === `remove:${inspectSkill.id}` ? "Removing…" : "Uninstall"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="send"
                      disabled={installing !== null}
                      onClick={() => attachSkill(inspectSkill)}
                    >
                      {installing === inspectSkill.id ? "Installing…" : "Attach to Chat ($)"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="chip send"
                      disabled={installing !== null}
                      onClick={() => void installRequestedSkill({ ...inspectSkill, content: inspectContent ?? inspectSkill.content })}
                    >
                      {installing === inspectSkill.id ? "Installing…" : "Install Skill"}
                    </button>
                    <button
                      type="button"
                      className="send"
                      disabled={installing !== null}
                      onClick={() => void installRequestedSkill({ ...inspectSkill, content: inspectContent ?? inspectSkill.content }, true)}
                    >
                      Install & Attach ($)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pack Detail Modal */}
      {inspectPack && (
        <div
          className="skill-inspect-overlay"
          onClick={() => setInspectPack(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="skill-inspect-modal" onClick={(e) => e.stopPropagation()}>
            <div className="skill-inspect-header">
              <div>
                <div className="skill-modal-title-row">
                  <h2>{inspectPack.name}</h2>
                  <span className="pack-badge">Skill Pack</span>
                  {inspectPack.author && <span className="pack-author">by {inspectPack.author}</span>}
                </div>
                <div className="skill-modal-meta">
                  <span>{inspectPack.skillCount} curated skills</span>
                </div>
              </div>
              <button
                type="button"
                className="skill-inspect-close"
                onClick={() => setInspectPack(null)}
              >
                <XIcon size={18} />
              </button>
            </div>

            <div className="skill-inspect-body">
              {mutationError && <p className="skill-folder-error" role="alert">{mutationError}</p>}
              <p className="pack-detail-desc">{inspectPack.description}</p>

              <div className="pack-included-skills">
                <h4>Included Skills in this Pack:</h4>
                <div className="pack-modal-skills-list">
                  {skills
                    .filter((s) => s.packId === inspectPack.id)
                    .map((s) => (
                      <div className="pack-modal-skill-item" key={s.id}>
                        <div className="pack-modal-skill-main">
                          <div className="pack-modal-skill-name">
                            <b>{s.name}</b>
                            {s.version && <span className="skill-version">v{s.version}</span>}
                          </div>
                          <p>{s.description}</p>
                        </div>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setInspectPack(null);
                            setInspectSkill(s);
                          }}
                        >
                          View SKILL.md
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              <div className="pack-cli-section">
                <h4>Install via CLI:</h4>
                <div className="pack-card-cli-row">
                  <code className="pack-cmd mono">
                    {inspectPack.installCommand ?? `npx skills add https://skills.sh/p/${inspectPack.id}`}
                  </code>
                  <button
                    type="button"
                    className="pack-cmd-copy"
                    onClick={() =>
                      void handleCopyText(
                        inspectPack.installCommand ?? `npx skills add https://skills.sh/p/${inspectPack.id}`,
                      )
                    }
                  >
                    {copiedCmd ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="skill-inspect-footer">
              <button
                type="button"
                className="ghost"
                onClick={() => setInspectPack(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="send"
                disabled={installing !== null || inspectedPackInstalled}
                onClick={() => void installPack(inspectPack)}
              >
                {installing === `pack:${inspectPack.id}` ? "Installing…" : inspectedPackInstalled ? "Installed" : "Install All Skills in Pack"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
