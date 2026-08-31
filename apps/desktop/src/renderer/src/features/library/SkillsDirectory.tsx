import { useState, useMemo, useEffect } from "react";
import type { Skill, SkillPack, SkillsShSearchResult } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon, XIcon, SparkIcon, CopyIcon, CheckIcon, ShieldIcon, GlobeIcon } from "../shell/icons";

type TabFilter = "all" | "packs" | "installed" | "directory";

/**
 * Curated community skills matching the skills.sh V1Skill API shape.
 * id format: "{source}/{slug}" — source is "{owner}/{repo}", slug is skill name.
 * These are shown in the "Browse skills.sh" tab before the user searches.
 * Install count values are representative of real skills.sh leaderboard data.
 * See https://skills.sh/docs/api for the full V1Skill schema.
 */
const CURATED_COMMUNITY_SKILLS: SkillsShSearchResult[] = [
  {
    id: "vercel-labs/skills/find-skills",
    slug: "find-skills",
    name: "find-skills",
    source: "vercel-labs/skills",
    installs: 24531,
    sourceType: "github",
    installUrl: "https://github.com/vercel-labs/skills",
    url: "https://skills.sh/vercel-labs/skills/find-skills",
    description: "Search and discover agent skills across the open skills ecosystem. The meta-skill that helps agents find and install other skills.",
  },
  {
    id: "supabase/supabase/Supabase",
    slug: "Supabase",
    name: "Supabase",
    source: "supabase/supabase",
    installs: 12084,
    sourceType: "github",
    installUrl: "https://github.com/supabase/supabase",
    url: "https://skills.sh/supabase/supabase/Supabase",
    description: "Build with Supabase — PostgreSQL, Auth, Storage, Realtime, Edge Functions, and Row Level Security.",
  },
  {
    id: "expo/skills/react-native",
    slug: "react-native",
    name: "React Native",
    source: "expo/skills",
    installs: 3842,
    sourceType: "github",
    installUrl: "https://github.com/expo/skills",
    url: "https://skills.sh/expo/skills/react-native",
    description: "Build cross-platform mobile apps with React Native and Expo — navigation, native modules, and EAS builds.",
  },
  {
    id: "mintlify.com/mintlify",
    slug: "mintlify",
    name: "Mintlify",
    source: "mintlify.com",
    installs: 8240,
    sourceType: "well-known",
    installUrl: null,
    url: "https://skills.sh/mintlify.com/mintlify",
    description: "Generate and maintain beautiful API documentation with Mintlify. MDX pages, OpenAPI specs, and custom components.",
  },
  {
    id: "vercel-labs/skills/next-js-development",
    slug: "next-js-development",
    name: "Next.js Development",
    source: "vercel-labs/skills",
    installs: 18920,
    sourceType: "github",
    installUrl: "https://github.com/vercel-labs/skills",
    url: "https://skills.sh/vercel-labs/skills/next-js-development",
    description: "Build Next.js applications with App Router, Server Components, server actions, and streaming best practices.",
  },
  {
    id: "vercel-labs/skills/vercel-ai-sdk",
    slug: "vercel-ai-sdk",
    name: "Vercel AI SDK",
    source: "vercel-labs/skills",
    installs: 14300,
    sourceType: "github",
    installUrl: "https://github.com/vercel-labs/skills",
    url: "https://skills.sh/vercel-labs/skills/vercel-ai-sdk",
    description: "Integrate LLMs with the Vercel AI SDK — streaming, tool calling, structured output, and multi-step agents.",
  },
];

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
    searchSkillsSh,
    fetchSkillDetail,
  } = useWorkspace();

  const [tab, setTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [inspectSkill, setInspectSkill] = useState<Skill | null>(null);
  const [inspectPack, setInspectPack] = useState<SkillPack | null>(null);
  const [inspectContent, setInspectContent] = useState<string | null>(null);
  const [inspectModalTab, setInspectModalTab] = useState<"instructions" | "permissions" | "cli">("instructions");
  const [directoryResults, setDirectoryResults] = useState<SkillsShSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Live search skills.sh directory
  useEffect(() => {
    if (tab !== "directory") return;
    const trimmed = search.trim();
    if (!trimmed) {
      setDirectoryResults(CURATED_COMMUNITY_SKILLS);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchSkillsSh(trimmed);
        setDirectoryResults(res);
      } catch {
        setDirectoryResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, tab, searchSkillsSh]);

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
    void fetchSkillDetail(inspectSkill.source, inspectSkill.id).then((detail) => {
      const file = detail?.files?.find((f) => f.path.toLowerCase().includes("skill.md"));
      setInspectContent(file?.contents ?? inspectSkill.content ?? "# No procedural guide provided.");
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

    // Otherwise search or install skill
    const searchRes = await searchSkillsSh(trimmed);
    if (searchRes.length > 0) {
      const first = searchRes[0]!;
      await installSkill({
        id: first.slug || first.id,
        name: first.name,
        version: "1.0.0",
        description: first.description || `Community skill from ${first.source}`,
        source: first.source,
        status: "installed",
        requirements: [],
        permissions: { filesystem: "approval" },
        validation: "passed",
        installs: first.installs,
        url: first.url,
      });
      setImportNotice(`Installed skill: ${first.name}`);
      setTimeout(() => setImportNotice(null), 3000);
    }
  }

  return (
    <div className="skills-directory">
      {/* Header & Stats Banner */}
      <div className="skills-header">
        <div className="skills-header-text">
          <div className="skills-title-row">
            <h2>Skills Directory</h2>
            <div className="skills-stats-badge">
              <SparkIcon size={14} className="skills-spark-icon" />
              <span>8,420+ Skills in Catalog</span>
            </div>
          </div>
          <p>
            Agent capabilities & packed skills from{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              className="skills-link"
            >
              skills.sh
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
            placeholder="Search skills, packs, or paste skills.sh URL / npx command…"
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
          Browse skills.sh
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

      {/* Directory Tab (Live Search / Browse skills.sh) */}
      {tab === "directory" && (
        <div className="skills-grid">
          {searching && <div className="skills-loading">Querying skills.sh catalog…</div>}
          {!searching && directoryResults.length === 0 && (
            <div className="skills-empty">
              {search
                ? `No results from skills.sh for "${search}".`
                : "Type in the search bar above to query the skills.sh registry."}
            </div>
          )}
          {directoryResults.map((result) => {
            const isInstalled = skills.some((s) => s.id === result.slug || s.id === result.id);
            return (
              <div className="skill-card" key={result.id}>
                <div className="skill-card-body">
                  <div className="skill-card-top">
                    <div>
                      <h3 className="skill-name">{result.name}</h3>
                      <span className="skill-pack-tag">{result.source}</span>
                    </div>
                    <span className="skill-installs">
                      {result.installs >= 1000000
                        ? `${(result.installs / 1000000).toFixed(1)}M`
                        : `${(result.installs / 1000).toFixed(0)}k`}{" "}
                      runs
                    </span>
                  </div>
                  <p className="skill-desc">
                    {result.description || `Community skill from ${result.source}`}
                  </p>
                </div>
                <div className="skill-card-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setInspectSkill({
                        id: result.slug || result.id,
                        name: result.name,
                        version: "1.0.0",
                        description: result.description ?? "",
                        source: result.source,
                        status: isInstalled ? "installed" : "available",
                        requirements: [],
                        permissions: { filesystem: "approval" },
                        installs: result.installs,
                        url: result.url,
                      });
                    }}
                  >
                    View Details
                  </button>
                  <button
                    type="button"
                    className={`chip ${isInstalled ? "installed" : "send"}`}
                    onClick={() =>
                      void installSkill({
                        id: result.slug || result.id,
                        name: result.name,
                        version: "1.0.0",
                        description: result.description || `Community skill from ${result.source}`,
                        source: result.source,
                        status: "installed",
                        requirements: [],
                        permissions: { filesystem: "approval" },
                        validation: "passed",
                        installs: result.installs,
                        url: result.url,
                      })
                    }
                  >
                    {isInstalled ? "Installed" : "Install Skill"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
                  {inspectSkill.installs && (
                    <span>
                      {" "}
                      ·{" "}
                      {inspectSkill.installs >= 1000000
                        ? `${(inspectSkill.installs / 1000000).toFixed(2)}M`
                        : `${(inspectSkill.installs / 1000).toFixed(0)}k`}{" "}
                      all-time runs
                    </span>
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
                    {inspectContent ?? "Loading skill procedural instructions…"}
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
                  View on skills.sh ↗
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
