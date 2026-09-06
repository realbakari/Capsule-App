import { useEffect, useRef } from "react";
import { FileIcon, CpuIcon } from "../shell/icons";

export interface SuggestItem {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  kind?: "file" | "skill";
  insert?: string;
  run?: () => void | Promise<void>;
}

export function ComposerMenu({
  items,
  index,
  onPick,
  onHover,
  id,
  empty,
}: {
  items: SuggestItem[];
  index: number;
  onPick: (item: SuggestItem) => void;
  onHover: (index: number) => void;
  id: string;
  empty?: string;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);
  if (items.length === 0 && !empty) return null;
  return (
    <div ref={menu} id={id} className="suggest-menu" role="listbox" aria-label="Composer suggestions">
      {empty && items.length === 0 && <div className="suggest-empty" role="status">{empty}</div>}
      {items.map((item, itemIndex) => (
        <button
          type="button"
          key={item.id}
          id={`${id}-${itemIndex}`}
          role="option"
          aria-selected={itemIndex === index}
          tabIndex={-1}
          className={itemIndex === index ? "active" : ""}
          onMouseEnter={() => onHover(itemIndex)}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => onPick(item)}
        >
          {item.kind === "file" ? <FileIcon size={14} /> : item.kind === "skill" ? <CpuIcon size={14} /> : null}
          <span className="suggest-copy"><span className="suggest-name">{item.label}</span>
            {item.detail ? <span className="meta" title={item.detail}>{item.detail}</span> : null}
          </span>
          {item.badge && <span className="suggest-badge">{item.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function detectTrigger(
  value: string,
  caret: number,
): { kind: "slash" | "file" | "skill"; query: string; start: number } | undefined {
  const before = value.slice(0, caret);
  const slash = /(^|\n)\/([^\s]*)$/.exec(before);
  if (slash?.[1] !== undefined && slash[2] !== undefined && slash.index !== undefined) {
    return { kind: "slash", query: slash[2], start: slash.index + slash[1].length };
  }
  const at = /(^|[\s])@([^\s]*)$/.exec(before);
  if (at?.[1] !== undefined && at[2] !== undefined && at.index !== undefined) {
    return { kind: "file", query: at[2], start: at.index + at[1].length };
  }
  const skill = /(^|[\s])\$([^\s]*)$/.exec(before);
  if (skill?.[1] !== undefined && skill[2] !== undefined && skill.index !== undefined) {
    return { kind: "skill", query: skill[2], start: skill.index + skill[1].length };
  }
}
