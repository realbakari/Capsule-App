import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { FolderPlusIcon, GitBranchIcon, GlobeIcon, SearchIcon } from "./icons";

export type ProjectSourceId = "folder" | "git-url" | "github";

interface ProjectSource {
  id: ProjectSourceId;
  label: string;
  detail: string;
  icon: typeof FolderPlusIcon;
}

/*
 * Only what Capsule can actually do. A list that also named Bitbucket, GitLab
 * and Azure would be describing an app that does not exist yet: a clone from
 * any of them already works through Git URL, and a row that says otherwise is
 * a promise.
 */
const SOURCES: ProjectSource[] = [
  { id: "folder", label: "Local folder", detail: "Attach a folder on this Mac", icon: FolderPlusIcon },
  { id: "git-url", label: "Git URL", detail: "Clone from any remote — https or ssh", icon: GlobeIcon },
  {
    id: "github",
    label: "GitHub repository",
    detail: "Clone by owner/repo",
    icon: GitBranchIcon,
  },
];

/** One place to add a project, whichever way the project arrives. */
export function AddProjectPicker({
  onPick,
  onClose,
}: {
  onPick: (source: ProjectSourceId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return SOURCES;
    return SOURCES.filter(
      (source) =>
        source.label.toLowerCase().includes(needle) || source.detail.toLowerCase().includes(needle),
    );
  }, [query]);
  const active = Math.min(index, Math.max(0, matches.length - 1));

  /*
   * Through a portal, because this is opened from the sidebar and the sidebar
   * carries a backdrop-filter when the translucent setting is on. A filtered
   * element becomes the containing block for its fixed-position descendants,
   * so the overlay was laid out inside the rail — and clipped by its
   * overflow: hidden — instead of covering the window.
   */
  const picker = (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search-row">
          <SearchIcon size={16} />
          <input
            autoFocus
            type="text"
            placeholder="Search sources…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex(Math.min(matches.length - 1, active + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex(Math.max(0, active - 1));
              }
              if (event.key === "Enter" && matches[active]) {
                event.preventDefault();
                onPick(matches[active]!.id);
              }
              if (event.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="palette-list">
          <p className="palette-section">Sources</p>
          {matches.length === 0 && <p className="palette-empty">No source matches that.</p>}
          {matches.map((source, sourceIndex) => {
            const Icon = source.icon;
            return (
              <button
                key={source.id}
                className={`palette-source${sourceIndex === active ? " active" : ""}`}
                onMouseEnter={() => setIndex(sourceIndex)}
                onClick={() => onPick(source.id)}
              >
                <span className="palette-source-icon">
                  <Icon size={16} />
                </span>
                <span className="palette-source-copy">
                  <b>{source.label}</b>
                  <small>{source.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="palette-hints" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Select
          </span>
          <span>
            <kbd>esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(picker, document.body) : picker;
}
