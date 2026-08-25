export interface SuggestItem {
  id: string;
  label: string;
  detail?: string;
  insert?: string;
  run?: () => void | Promise<void>;
}

export function ComposerMenu({
  items,
  index,
  onPick,
  onHover,
}: {
  items: SuggestItem[];
  index: number;
  onPick: (item: SuggestItem) => void;
  onHover: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="suggest-menu" role="listbox">
      {items.map((item, itemIndex) => (
        <button
          type="button"
          key={item.id}
          className={itemIndex === index ? "active" : ""}
          onMouseEnter={() => onHover(itemIndex)}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          <span>{item.label}</span>
          {item.detail ? <span className="meta">{item.detail}</span> : null}
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
