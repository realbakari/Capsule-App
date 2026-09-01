import { useState, useMemo, useEffect } from "react";
import type { Skill, SkillPack, SkillCatalogEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon, XIcon, SparkIcon, CopyIcon, CheckIcon, ShieldIcon, GlobeIcon } from "../shell/icons";

type TabFilter = "all" | "packs" | "installed" | "directory";

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

export function SkillsDirectory() {
  const {
    skills,
    skillPacks,
    skillId,
    setSkillId,
    setView,
    installSkill,
    installSkillPack,
    uninstallSkill,
    searchSkillCatalog,
    fetchSkillDetail,
  } = useWorkspace();

  const [tab, setTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [inspectSkill, setInspectSkill] = useState<Skill | null>(null);
  const [inspectPack, setInspectPack] = useState<SkillPack | null>(null);
  const [inspectContent, setInspectContent] = useState<string | null>(null);
  const [inspectModalTab, setInspectModalTab] = useState<"instructions" | "permissions" | "cli">("instructions");
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
      ? `${inspectSkill.source}/${inspectSkill.id}`
      : undefined;
    if (!catalogId) {
      setInspectContent(inspectSkill.content ?? null);
      return;
    }
    void fetchSkillDetail(catalogId).then((doc) => {
      setInspectContent(doc ?? inspectSkill.content ?? null);
    });
  }, [inspectSkill, fetchSkillDetail]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const skill of skills) {
      if (skill.tags) {
        for (const t of skill.tags) set.add(t);
      }
    }
    return Array.from(set);
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (tab === "installed" && s.status !== "installed") return false;
      if (selectedTag && !s.tags?.includes(selectedTag)) return false;
      if (!query) return true;
      return (
        s.name.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.packName?.toLowerCase().includes(query) ||
        s.tags?.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [skills, tab, search, selectedTag]);

  const filteredPacks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skillPacks.filter((p) => {
      if (selectedTag && !p.tags?.includes(selectedTag)) return false;
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.author?.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [skillPacks, search, selectedTag]);

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

  async function handleImportInput(input: string) {
    setImportNotice(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    // Check if it's a pack url or id
    const pack = skillPacks.find(
      (p) =>
        p.id === trimmed ||
        trimmed.includes(`/p/${p.id}`) ||
        trimmed.includes(p.id),
    );
    if (pack) {
      await installSkillPack(pack.id);
      setImportNotice(`Installed pack: ${pack.name}`);
      setTimeout(() => setImportNotice(null), 3000);
      return;
    }

    // Otherwise resolve it against the live catalog.
    const page = await searchSkillCatalog(trimmed);
    const first = page.entries[0];
    if (!first) {
      setImportNotice(`Nothing in the catalog matches "${trimmed}".`);
      setTimeout(() => setImportNotice(null), 4000);
      return;
    }
    await installFromCatalog(first);
  }

  return (
    <div className="skills-directory">
      {/* Header & Stats Banner */}
      <div className="skills-header">
        <div className="skills-header-text">
          <div className="skills-title-row">
            <h2>Skills Directory</h2>
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
            Bundled packs plus a live catalog read from the skill repositories on{" "}
            <a href="https://github.com/topics/agent-skills" target="_blank" rel="noreferrer" className="skills-link">
              GitHub
            </a>
            . Inspect instructions before installing, or attach with <code className="mono">$skill</code> in the composer.
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
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleImportInput(search);
            }}
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

      {/* Tabs */}
      <div className="skills-tabs">
        <button
          type="button"
          className={`skills-tab ${tab === "all" ? "active" : ""}`}
          onClick={() => {
            setTab("all");
            setSelectedTag(null);
          }}
        >
          All Skills <span className="tab-count">{skills.length}</span>
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === "packs" ? "active" : ""}`}
          onClick={() => {
            setTab("packs");
            setSelectedTag(null);
          }}
        >
          Skill Packs <span className="tab-count">{skillPacks.length}</span>
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === "installed" ? "active" : ""}`}
          onClick={() => {
            setTab("installed");
            setSelectedTag(null);
          }}
        >
          Installed{" "}
          <span className="tab-count">
            {skills.filter((s) => s.status === "installed").length}
          </span>
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === "directory" ? "active" : ""}`}
          onClick={() => {
            setTab("directory");
            setSelectedTag(null);
          }}
        >
          Browse GitHub
        </button>
      </div>

      {/* Tag Filters (for All and Installed) */}
      {(tab === "all" || tab === "installed") && allTags.length > 0 && (
        <div className="skills-tag-filters">
          <button
            type="button"
            className={`tag-chip ${selectedTag === null ? "active" : ""}`}
            onClick={() => setSelectedTag(null)}
          >
            All Categories
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-chip ${selectedTag === tag ? "active" : ""}`}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Packs View */}
      {tab === "packs" && (
        <div className="packs-grid">
          {filteredPacks.length === 0 && (
            <div className="skills-empty">No skill packs found matching &ldquo;{search}&rdquo;.</div>
          )}
          {filteredPacks.map((pack) => {
            const packSkills = skills.filter((s) => s.packId === pack.id);
            const allInstalled = packSkills.length > 0 && packSkills.every((s) => s.status === "installed");
            const installCmd = pack.installCommand ?? `npx skills add https://skills.sh/p/${pack.id}`;
            const isCmdCopied = copiedCmd === installCmd;

            return (
              <div className="pack-card" key={pack.id}>
                <div className="pack-card-header">
                  <div className="pack-meta-row">
                    <span className="pack-badge">Skill Pack</span>
                    {pack.author && (
                      <span className="pack-author">by {pack.author}</span>
                    )}
                    <span className="pack-skill-count">
                      {pack.skillCount || packSkills.length} skills
                    </span>
                  </div>
                  <h3 className="pack-title">{pack.name}</h3>
                  <p className="pack-desc">{pack.description}</p>
                </div>

                {packSkills.length > 0 && (
                  <div className="pack-skills-section">
                    <div className="pack-skills-heading">Included Skills (Click to inspect):</div>
                    <div className="pack-skills-pills">
                      {packSkills.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="pack-skill-pill"
                          onClick={() => setInspectSkill(s)}
                          title={`Click to view ${s.name} details & SKILL.md`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pack-card-cli-row">
                  <code className="pack-cmd mono">{installCmd}</code>
                  <button
                    type="button"
                    className="pack-cmd-copy"
                    onClick={() => void handleCopyText(installCmd)}
                    title="Copy CLI install command"
                  >
                    {isCmdCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  </button>
                </div>

                <div className="pack-card-footer">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setInspectPack(pack)}
                  >
                    View Pack Details
                  </button>
                  <button
                    type="button"
                    className={`chip ${allInstalled ? "installed" : "send"}`}
                    onClick={() => void installSkillPack(pack.id)}
                  >
                    {allInstalled ? "Pack Installed" : "Install Pack"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Skills Grid (All / Installed) */}
      {(tab === "all" || tab === "installed") && (
        <div className="skills-grid">
          {filteredSkills.length === 0 && (
            <div className="skills-empty">No skills found matching &ldquo;{search}&rdquo;.</div>
          )}
          {filteredSkills.map((skill) => {
            const isAttached = skillId === skill.id;
            const isInstalled = skill.status === "installed";

            return (
              <div
                className={`skill-card ${isAttached ? "attached" : ""}`}
                key={skill.id}
              >
                <div className="skill-card-body">
                  <div className="skill-card-top">
                    <div>
                      <div className="skill-title-row">
                        <h3 className="skill-name">{skill.name}</h3>
                        {skill.version && (
                          <span className="skill-version">v{skill.version}</span>
                        )}
                      </div>
                      {skill.packName && (
                        <span className="skill-pack-tag">{skill.packName}</span>
                      )}
                    </div>

                    <div className="skill-badges">
                      {skill.installs && (
                        <span className="skill-installs">
                          {skill.installs >= 1000000
                            ? `${(skill.installs / 1000000).toFixed(1)}M`
                            : skill.installs >= 1000
                              ? `${(skill.installs / 1000).toFixed(0)}k`
                              : skill.installs}{" "}
                          runs
                        </span>
                      )}
                      <span className={`skill-status-badge ${skill.status}`}>
                        {skill.status}
                      </span>
                    </div>
                  </div>

                  <p className="skill-desc">{skill.description}</p>

                  {skill.tags && skill.tags.length > 0 && (
                    <div className="skill-tags">
                      {skill.tags.map((tag) => (
                        <span key={tag} className="skill-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="skill-card-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setInspectSkill(skill)}
                  >
                    View Details
                  </button>
                  {isInstalled ? (
                    <button
                      type="button"
                      className={`chip ${isAttached ? "active-attached" : "send"}`}
                      onClick={() => {
                        setSkillId(skill.id);
                        setView("chat");
                      }}
                    >
                      {isAttached ? "Attached" : "Attach to Chat"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="chip send"
                      onClick={() => void installSkill(skill)}
                    >
                      Install Skill
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Directory tab — live from the source repositories on GitHub. */}
      {tab === "directory" && (
        <>
          <div className="skills-source-bar">
            <span className="skills-source-state">
              <span
                className={`skills-source-dot ${skillsShConnected ? "on" : "off"}`}
                aria-hidden
              />
              {skillsShConnected
                ? "GitHub + skills.sh"
                : "GitHub only — add a skills.sh token in Settings for install counts"}
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
            <div className="skills-notice skills-notice-warn">
              Some sources did not load: {directoryPartial.join("; ")}
            </div>
          )}
          <div className="skills-grid">
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
            {directoryResults.map((result) => {
              const isInstalled = skills.some((s) => s.id === result.id);
              return (
                <div className="skill-card" key={result.id}>
                  <div className="skill-card-body">
                    <div className="skill-card-top">
                      <div>
                        <h3 className="skill-name">{result.name}</h3>
                        <a
                          className="skill-pack-tag skill-source-link"
                          href={result.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {result.source}
                        </a>
                      </div>
                      {/* Each metric is a real number from whichever source
                          returned it: installs from skills.sh, stars from the
                          GitHub repo record. A source that reports neither
                          shows nothing rather than a placeholder. */}
                      {typeof result.installs === "number" ? (
                        <span
                          className="skill-installs"
                          title={`${result.installs.toLocaleString()} installs reported by skills.sh`}
                        >
                          {compactCount(result.installs)} installs
                        </span>
                      ) : typeof result.stars === "number" ? (
                        <span
                          className="skill-installs"
                          title={`${result.stars.toLocaleString()} stars on ${result.source}`}
                        >
                          {compactCount(result.stars)} ★
                        </span>
                      ) : null}
                    </div>
                    {result.description ? (
                      <p className="skill-desc">{result.description}</p>
                    ) : (
                      <p className="skill-desc skill-desc-missing">No description in SKILL.md.</p>
                    )}
                  </div>
                  <div className="skill-card-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setInspectSkill(
                          skillFromCatalog(result, isInstalled ? "installed" : "available"),
                        )
                      }
                    >
                      View Details
                    </button>
                    <button
                      type="button"
                      className={`chip ${isInstalled ? "installed" : "send"}`}
                      disabled={installing === result.id}
                      onClick={() => void installFromCatalog(result)}
                    >
                      {installing === result.id
                        ? "Installing…"
                        : isInstalled
                          ? "Installed"
                          : "Install Skill"}
                    </button>
                  </div>
                </div>
              );
            })}
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
                className={`skill-subnav-btn ${inspectModalTab === "permissions" ? "active" : ""}`}
                onClick={() => setInspectModalTab("permissions")}
              >
                Permissions & Policy
              </button>
              <button
                type="button"
                className={`skill-subnav-btn ${inspectModalTab === "cli" ? "active" : ""}`}
                onClick={() => setInspectModalTab("cli")}
              >
                CLI Command
              </button>
            </div>

            <div className="skill-inspect-body">
              {inspectModalTab === "instructions" && (
                <div className="skill-inspect-content">
                  <p className="skill-modal-desc">{inspectSkill.description}</p>
                  <pre className="mono skill-markdown-pre">
                    {inspectContent ?? "SKILL.md could not be loaded for this skill."}
                  </pre>
                </div>
              )}

              {inspectModalTab === "permissions" && (
                <div className="skill-permissions-view">
                  <div className="permissions-card">
                    <div className="permissions-row">
                      <ShieldIcon size={16} />
                      <div className="permissions-info">
                        <b>Filesystem Access</b>
                        <p>Requires user approval before modifying files outside workspace.</p>
                      </div>
                      <span className="permission-chip">Approval Required</span>
                    </div>
                    <div className="permissions-row">
                      <GlobeIcon size={16} />
                      <div className="permissions-info">
                        <b>External Network</b>
                        <p>Allowed for fetching documentation and public APIs.</p>
                      </div>
                      <span className="permission-chip">Standard</span>
                    </div>
                  </div>
                </div>
              )}

              {inspectModalTab === "cli" && (
                <div className="skill-cli-view">
                  <p>Install via the open skills CLI:</p>
                  <div className="pack-card-cli-row">
                    <code className="pack-cmd mono">
                      {inspectSkill.url ? `npx skills add ${inspectSkill.url}` : `npx skills add ${inspectSkill.id}`}
                    </code>
                    <button
                      type="button"
                      className="pack-cmd-copy"
                      onClick={() =>
                        void handleCopyText(
                          inspectSkill.url
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
                <a
                  href={inspectSkill.url}
                  target="_blank"
                  rel="noreferrer"
                  className="skills-link"
                >
                  {inspectSkill.url.startsWith("https://github.com/") ? "View on GitHub ↗" : "View source ↗"}
                </a>
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
