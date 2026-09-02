import { useState, useMemo, useEffect } from "react";
import type { FileEntry, FilePreview, Skill, SkillPack, SkillCatalogEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { skillMarkdownBody } from "../../lib/skill-markdown";
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
  onInspect,
  onAttach,
}: {
  title: string;
  description: string;
  skills: Skill[];
  empty: string;
  skillId?: string;
  onInspect: (skill: Skill) => void;
  onAttach: (id: string) => void;
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
                onClick={() => onAttach(skill.id)}
              >
                {skillId === skill.id ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                {skillId === skill.id ? "Attached" : "Attach"}
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
  const [listing, setListing] = useState<FileEntry[]>([]);
  const [childrenByDirectory, setChildrenByDirectory] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderPath = skill.location?.replace(/[\\/]SKILL\.md$/i, "");

  useEffect(() => {
    let cancelled = false;
    setListing([]);
    setChildrenByDirectory({});
    setExpanded(new Set());
    setPreview(null);
    setError(null);
    void window.capsule
      .listSkillFiles(skill.id)
      .then(async (entries) => {
        if (cancelled) return;
        const nextEntries = entries as FileEntry[];
        setListing(nextEntries);
        const firstFile = nextEntries.find((entry) => entry.type === "file");
        if (!firstFile) return;
        const doc = (await window.capsule.previewSkillFile(skill.id, firstFile.path)) as FilePreview;
        if (!cancelled) setPreview(doc);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [skill.id]);

  async function toggleDirectory(relative: string) {
    const next = new Set(expanded);
    if (next.has(relative)) {
      next.delete(relative);
      setExpanded(next);
      return;
    }
    next.add(relative);
    setExpanded(next);
    if (childrenByDirectory[relative]) return;
    setLoadingDirectories((current) => new Set(current).add(relative));
    try {
      const entries = (await window.capsule.listSkillFiles(skill.id, relative)) as FileEntry[];
      setChildrenByDirectory((current) => ({ ...current, [relative]: entries }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingDirectories((current) => {
        const remaining = new Set(current);
        remaining.delete(relative);
        return remaining;
      });
    }
  }

  async function previewFile(relative: string) {
    try {
      setPreview((await window.capsule.previewSkillFile(skill.id, relative)) as FilePreview);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

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
              onClick={() => void toggleDirectory(entry.path)}
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
              ) : (
                rows(childrenByDirectory[entry.path] ?? [], depth + 1)
              )
            ) : null}
          </div>
        );
      }
      return (
        <button
          type="button"
          className={`skill-file-tree-row file${preview?.path === entry.path ? " active" : ""}`}
          style={{ paddingLeft: `${1.8 + depth * 0.75}rem` }}
          key={entry.path}
          onClick={() => void previewFile(entry.path)}
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
      {error ? <div className="skill-folder-error">{error}</div> : null}
      <div className="skill-folder-workspace">
        <div className="skill-file-tree">
          {listing.length > 0 ? rows(listing) : <p>No files available.</p>}
        </div>
        <div className="skill-file-preview">
          {preview ? (
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
  const [inspectContent, setInspectContent] = useState<string | null>(null);
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
        setDirectoryResults([]);
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
    if (!inspectSkill) {
      setInspectContent(null);
      return;
    }
    setInspectModalTab("instructions");
    if (inspectSkill.content) {
      setInspectContent(inspectSkill.content);
      return;
    }
    const catalogId = inspectSkill.url?.startsWith("https://github.com/")
      ? inspectSkill.id
      : undefined;
    if (!catalogId) {
      setInspectContent(inspectSkill.content ?? null);
      return;
    }
    void fetchSkillDetail(catalogId).then((doc) => {
      setInspectContent(doc ?? inspectSkill.content ?? null);
    });
  }, [inspectSkill, fetchSkillDetail]);

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

  async function refreshInstalledSkills() {
    setRefreshingInstalled(true);
    try {
      await refresh();
    } finally {
      setRefreshingInstalled(false);
    }
  }

  /**
   * Install a catalog skill, fetching its SKILL.md first. Without the document
   * the skill has nothing to inject; refusing to save it is better than saving
   * something that silently does nothing.
   */
  async function installFromCatalog(entry: SkillCatalogEntry) {
    setInstalling(entry.id);
    try {
      const doc = await fetchSkillDetail(entry.id);
      if (!doc) {
        setImportNotice(`Could not read SKILL.md for ${entry.name}; nothing was installed.`);
        setTimeout(() => setImportNotice(null), 5000);
        return;
      }
      await installSkill(skillFromCatalog(entry, "installed", doc));
      setImportNotice(`Installed ${entry.name}.`);
      setTimeout(() => setImportNotice(null), 3000);
    } finally {
      setInstalling(null);
    }
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

      {importNotice && <div className="skills-notice">{importNotice}</div>}

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
            onInspect={setInspectSkill}
            onAttach={(id) => {
              setSkillId(id);
              setView("chat");
            }}
          />

          <InstalledSkillGroup
            title="Capsule library"
            description="Skills and packs installed through Capsule."
            skills={capsuleSkills}
            empty="No matching Capsule-managed skills are installed."
            skillId={skillId}
            onInspect={setInspectSkill}
            onAttach={(id) => {
              setSkillId(id);
              setView("chat");
            }}
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
                    disabled={allInstalled}
                    onClick={() => void installSkillPack(pack.id)}
                  >
                    {allInstalled ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                    {allInstalled ? "Installed" : "Install"}
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
                <button type="button" className="ghost" onClick={() => setSearch((q) => q)}>
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
              const isInstalled = skills.some(
                (skill) =>
                  skill.status === "installed" &&
                  (skill.id === result.id ||
                    skill.name.toLowerCase() === result.name.toLowerCase()),
              );
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
                        skillFromCatalog(result, isInstalled ? "installed" : "available"),
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
                    disabled={isInstalled || installing === result.id}
                    onClick={() => void installFromCatalog(result)}
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
              {inspectModalTab === "instructions" && (
                <div className="skill-inspect-content">
                  <p className="skill-modal-desc">{inspectSkill.description}</p>
                  {inspectContent ? (
                    <div className="skill-markdown-rendered">
                      <MessageBody content={skillMarkdownBody(inspectContent)} />
                    </div>
                  ) : (
                    <p className="skills-empty">SKILL.md could not be loaded for this skill.</p>
                  )}
                </div>
              )}

              {inspectModalTab === "source" && (
                <pre className="mono skill-markdown-pre">
                  {inspectContent ?? "SKILL.md could not be loaded for this skill."}
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
                        onClick={() => {
                          void uninstallSkill(inspectSkill.id);
                          setInspectSkill(null);
                        }}
                      >
                        Uninstall
                      </button>
                    )}
                    <button
                      type="button"
                      className="send"
                      onClick={() => {
                        setSkillId(inspectSkill.id);
                        setInspectSkill(null);
                        setView("chat");
                      }}
                    >
                      Attach to Chat ($)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="chip send"
                      onClick={() => {
                        void installSkill(inspectSkill);
                        setInspectSkill((prev) => (prev ? { ...prev, status: "installed" } : null));
                      }}
                    >
                      Install Skill
                    </button>
                    <button
                      type="button"
                      className="send"
                      onClick={() => {
                        void installSkill(inspectSkill);
                        setSkillId(inspectSkill.id);
                        setInspectSkill(null);
                        setView("chat");
                      }}
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
                            <span className="skill-version">v{s.version}</span>
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
                onClick={() => {
                  void installSkillPack(inspectPack.id);
                  setInspectPack(null);
                  setImportNotice(`Installed pack: ${inspectPack.name}`);
                  setTimeout(() => setImportNotice(null), 3000);
                }}
              >
                Install All Skills in Pack
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
