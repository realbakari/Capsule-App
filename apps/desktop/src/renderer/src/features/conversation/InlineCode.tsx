import { fileKind } from "../../lib/file-kind";

/** Common source files, recognised even when written as a bare name. */
const KNOWN_EXTENSION = /\.(ts|tsx|js|jsx|json|css|scss|html|md|mdx|py|rs|go|rb|java|kt|swift|c|h|cc|cpp|cs|php|yml|yaml|toml|sh|mjs|cjs|sql|svg|txt|lock)$/i;
const ANY_EXTENSION = /\.[A-Za-z0-9_-]{1,10}$/;
const KNOWN_NAMES = /^(Makefile|Dockerfile|Gemfile|Procfile|LICENSE|README)$/;
/** A first segment that is a host ("docs.rs/…", "github.com/…") makes it a URL, not a path. */
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|rs|app|ai|co|sh|so|xyz|me)$/i;
/** Product names spelled like files ("Node.js", "Vue.js") are prose. */
const PRODUCT = /^[A-Z][a-z]+\.js$/;
/** A version ("v1.2", "1.2.3") is not a file name. */
const VERSION = /^v?\d+(\.\d+)+$/i;

interface FileRef { path: string; line?: string; name: string }

/*
 * When a code span is a file. A path needs a separator and a last segment
 * that is a file name; a bare name needs a well-known extension. A slash alone
 * says nothing: branch names (fix/login), folders (tmp/) and owner/repo pairs
 * carry one, and drawing them as files gave them a kind badge they don't have.
 */
export function readFileRef(value: string): FileRef | undefined {
  if (value.length < 3 || value.length > 160 || /\s/.test(value)) return undefined;
  if (value.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes("…")) return undefined;
  const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(value);
  const path = match?.[1] ?? value;
  const line = match?.[2];
  if (path.endsWith("/") || path.endsWith("\\")) return undefined;
  const segments = path.split(/[/\\]/);
  const name = segments.at(-1) ?? path;
  if (!name || VERSION.test(name)) return undefined;
  if (segments.length > 1) {
    if (HOST.test(segments[0]!)) return undefined;
    return ANY_EXTENSION.test(name) || KNOWN_NAMES.test(name) ? { path, line, name } : undefined;
  }
  if (PRODUCT.test(name)) return undefined;
  return KNOWN_EXTENSION.test(name) || (line && ANY_EXTENSION.test(name)) ? { path, line, name } : undefined;
}

export function InlineCode({ value, onOpen }: { value: string; onOpen?: (path: string) => void }) {
  const ref = readFileRef(value);
  if (!ref) return <code>{value}</code>;
  // The line travels with the path, so the preview opens where the reply pointed.
  const target = ref.line ? `${ref.path}:${ref.line}` : ref.path;
  const kind = fileKind(ref.name);
  const extension = ref.name.includes(".") ? ref.name.slice(ref.name.lastIndexOf(".") + 1, ref.name.lastIndexOf(".") + 3).toUpperCase() : "";
  const badge = kind.label === "•" && extension ? extension : kind.label;
  return (
    <code
      className={`file-chip${onOpen ? " file-mention" : ""}`}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(target) : undefined}
      onKeyDown={onOpen ? (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(target); }
      } : undefined}
      title={value}
    >
      <span className="file-chip-kind" style={{ color: `var(${kind.tone})` }} aria-hidden>{badge}</span>
      <span className="file-chip-name">{ref.name}{ref.line ? <span className="file-chip-line">:{ref.line}</span> : null}</span>
    </code>
  );
}
