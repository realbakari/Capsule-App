import { fileKind } from "../../lib/file-kind";

const FILE_EXTENSION = /\.(ts|tsx|js|jsx|json|css|html|md|py|rs|go|yml|yaml|toml|sh|mjs|cjs|sql|svg|txt)$/i;

function isFilePath(value: string): boolean {
  if (value.length < 3 || value.length > 120 || /\s/.test(value)) return false;
  if (value.startsWith("-") || value.startsWith("http")) return false;
  if (FILE_EXTENSION.test(value)) return true;
  return value.includes("/") && /[A-Za-z]/.test(value);
}

export function InlineCode({ value, onOpen }: { value: string; onOpen?: (path: string) => void }) {
  if (!isFilePath(value)) return <code>{value}</code>;
  const name = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1);
  const kind = fileKind(name);
  return (
    <code
      className={`file-chip${onOpen ? " file-mention" : ""}`}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(value) : undefined}
      onKeyDown={onOpen ? (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(value); }
      } : undefined}
      title={onOpen ? value : undefined}
    >
      <span className="file-chip-kind" style={{ color: `var(${kind.tone})` }} aria-hidden>{kind.label}</span>
      <span className="file-chip-name">{value}</span>
    </code>
  );
}
