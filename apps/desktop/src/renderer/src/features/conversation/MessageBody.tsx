import { Fragment, memo, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { highlight } from "../../lib/highlight";
import { splitFences } from "../../lib/fences";
import { parseTable } from "../../lib/tables";
import { stripHtmlComments, stripInlineTags } from "../../lib/markdown-html";
import { normalizeGitHubMarkdown } from "../../lib/github-markdown";
import { splitGitHubDetails } from "../../lib/github-details";
import { fileKind } from "../../lib/file-kind";
import { useWorkspace } from "../../lib/workspace";

/**
 * Heuristic: does the text inside backticks look like a file path?
 * Must have a recognised extension OR contain a `/` that isn't a URL or flag.
 */
const FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|json|css|html|md|py|rs|go|yml|yaml|toml|sh|mjs|cjs|sql|svg|txt)$/i;

function isFilePath(value: string): boolean {
  if (value.length < 3 || value.length > 120) return false;
  if (value.includes(" ") || value.includes("\n")) return false;
  if (value.startsWith("-") || value.startsWith("http")) return false;
  if (FILE_EXT_RE.test(value)) return true;
  // `3/16` is a fraction, not a path. A path needs a letter somewhere.
  if (/^\d+\/\d+$/.test(value)) return false;
  return value.includes("/") && /[A-Za-z]/.test(value);
}

function nameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

function FileChip({
  path,
  onOpen,
}: {
  path: string;
  onOpen?: (path: string) => void;
}) {
  const kind = fileKind(nameOf(path));
  const chip = (
    <>
      <span className="file-chip-kind" style={{ color: `var(${kind.tone})` }} aria-hidden>
        {kind.label}
      </span>
      <span className="file-chip-name">{path}</span>
    </>
  );
  if (!onOpen) return <code className="file-chip">{chip}</code>;
  return (
    <code
      className="file-chip file-mention"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(path)}
      onKeyDown={(event) => { if (event.key === "Enter") onOpen(path); }}
      title={path}
    >
      {chip}
    </code>
  );
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9]/.test(ch));
}

function canOpenEmphasis(text: string, index: number): boolean {
  const next = text[index + 1];
  if (!next || /\s/.test(next)) return false;
  return !isWordChar(text[index - 1]);
}

function canCloseEmphasis(text: string, index: number): boolean {
  const prev = text[index - 1];
  if (!prev || /\s/.test(prev)) return false;
  return !isWordChar(text[index + 1]);
}

/** Pair flanking markers in linear time; unmatched identifiers stay literal. */
function emphasisRanges(text: string): Array<{ start: number; end: number }> {
  const closers: Record<string, number[]> = { "*": [], "_": [] };
  for (let index = 0; index < text.length; index++) {
    const marker = text[index]!;
    if (closers[marker] && text[index + 1] !== marker && canCloseEmphasis(text, index)) {
      closers[marker]!.push(index);
    }
  }
  const positions: Record<string, number> = { "*": 0, "_": 0 };
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < text.length; start++) {
    const marker = text[start]!;
    const candidates = closers[marker];
    if (!candidates || text[start + 1] === marker || !canOpenEmphasis(text, start)) continue;
    let position = positions[marker]!;
    while (position < candidates.length && candidates[position]! < start + 2) position++;
    positions[marker] = position;
    const end = candidates[position];
    if (end === undefined) continue;
    ranges.push({ start, end: end + 1 });
    start = end;
  }
  return ranges;
}

function emphasize(
  text: string,
  onOpenFile?: (path: string) => void,
  onOpenLink?: (href: string) => void,
  depth = 0,
): ReactNode {
  const out: ReactNode[] = [];
  let position = 0;
  for (const match of emphasisRanges(text)) {
    out.push(stripInlineTags(text.slice(position, match.start)));
    out.push(<em key={match.start}>{inline(text.slice(match.start + 1, match.end - 1), onOpenFile, onOpenLink, depth + 1)}</em>);
    position = match.end;
  }
  out.push(stripInlineTags(text.slice(position)));
  return out;
}

function inline(
  text: string,
  onOpenFile?: (path: string) => void,
  onOpenLink?: (href: string) => void,
  depth = 0,
): ReactNode {
  // Agent output is untrusted; pathological nesting must not exhaust the stack.
  if (depth >= 16) return stripInlineTags(text);
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const inner = part.slice(1, -1);
      if (isFilePath(inner)) return <FileChip key={index} path={inner} onOpen={onOpenFile} />;
      return <code key={index}>{inner}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{inline(part.slice(2, -2), onOpenFile, onOpenLink, depth + 1)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return <s key={index}>{inline(part.slice(2, -2), onOpenFile, onOpenLink, depth + 1)}</s>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link?.[1] && link[2]) {
      const href = link[2];
      return (
        <a
          key={index}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (onOpenLink) onOpenLink(href);
            else window.open(href, "_blank", "noopener");
          }}
        >
          {inline(link[1], undefined, onOpenLink, depth + 1)}
        </a>
      );
    }
    return <Fragment key={index}>{emphasize(part, onOpenFile, onOpenLink, depth)}</Fragment>;
  });
}

function block(
  text: string,
  key: number,
  onOpenFile?: (path: string) => void,
  onOpenLink?: (href: string) => void,
  commentsStripped = false,
): ReactNode {
  const lines = (commentsStripped ? text : stripHtmlComments(text)).split("\n");
  const out: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const table = parseTable(lines, index);
    if (table) {
      out.push(
        <div className="md-table-wrap" key={`${key}-${index}-table`}>
          <table className="md-table">
            <thead>
              <tr>
                {table.table.headers.map((header, column) => (
                  <th key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                    {inline(header, onOpenFile, onOpenLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                      {inline(cell, onOpenFile, onOpenLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index += table.consumed - 1;
      continue;
    }

    /*
     * Blockquotes, and the alerts GitHub builds out of them.
     *
     * Neither was handled, so a pull request body arrived with a literal ">"
     * down the left of every quoted line — twenty-nine of them in one real
     * description — and "[!NOTE]" printed as though it were prose.
     */
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      index -= 1;
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(quoted[0] ?? "");
      const body = alert ? quoted.slice(1) : quoted;
      const kind = alert?.[1]?.toLowerCase();
      out.push(
        <div
          key={`${key}-${index}-quote`}
          className={kind ? `md-alert md-alert--${kind}` : "md-quote"}
        >
          {kind ? <b className="md-alert-title">{kind[0]!.toUpperCase() + kind.slice(1)}</b> : null}
          {block(body.join("\n"), key + index + 1, onOpenFile, onOpenLink, commentsStripped)}
        </div>,
      );
      continue;
    }

    // A rule, which is a divider and not three stray hyphens.
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={`${key}-${index}-hr`} className="md-hr" />);
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      out.push(
        <Tag key={`${key}-${index}`} className="md-h">
          {inline(heading[2], onOpenFile, onOpenLink)}
        </Tag>,
      );
      continue;
    }

    // A line that is only bold is a section title, not emphasis inside a sentence.
    const titled = /^\s*\*\*([^*]+)\*\*\s*$/.exec(line);
    if (titled?.[1]) {
      out.push(
        <h4 key={`${key}-${index}`} className="md-h">
          {inline(titled[1], onOpenFile, onOpenLink)}
        </h4>,
      );
      continue;
    }

    const indent = Math.min(3, Math.floor((/^\s*/.exec(line)?.[0].length ?? 0) / 2));
    const indentStyle = indent > 0 ? { paddingLeft: `${0.85 + indent * 0.85}rem` } : undefined;

    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const done = task[1] !== " ";
      out.push(
        <div key={`${key}-${index}`} className={`md-task${done ? " is-done" : ""}`} style={indentStyle}>
          <span className="md-task-mark" aria-hidden>{done ? "✓" : ""}</span>
          <span>{inline(task[2] ?? "", onOpenFile, onOpenLink)}</span>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      out.push(
        <div key={`${key}-${index}`} className="md-li" style={indentStyle}>
          {inline(line.replace(/^\s*[-*]\s+/, ""), onOpenFile, onOpenLink)}
        </div>,
      );
      continue;
    }

    // Ordered list
    const num = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (num?.[1] && num[2]) {
      out.push(
        <div key={`${key}-${index}`} className="md-li-num" style={indentStyle}>
          <span className="md-num">{num[1]}.</span>
          <span>{inline(num[2], onOpenFile, onOpenLink)}</span>
        </div>,
      );
      continue;
    }

    // Plain prose
    out.push(
      <Fragment key={`${key}-${index}`}>{inline(line, onOpenFile, onOpenLink)}</Fragment>,
    );
    if (index < lines.length - 1) out.push(<Fragment key={`${key}-${index}-nl`}>{"\n"}</Fragment>);
  }
  return out;
}

/*
 * Memoised: while a reply streams, the fences that already finished arriving
 * keep identical props, so they neither re-render nor re-tokenise.
 */
const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="msg-code-wrap">
      <div className="msg-code-bar">
        <span className="msg-code-lang">{language || "code"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className="msg-code mono">{highlight(code, language)}</pre>
    </div>
  );
});

export function MessageBody({ content, githubBaseUrl }: { content: string; githubBaseUrl?: string }) {
  const { openFile, setBrowserUrl, setInspectorOpen, setInspectorTab } = useWorkspace();

  /*
   * The path, not the folder it is in. This opened the file tree and stopped
   * there, so clicking a file the agent had just named left you to find it by
   * hand in a tree that was not even scrolled to it.
   */
  function handleOpenFile(path: string) {
    openFile(path);
  }

  function handleOpenLink(href: string) {
    if (/^https?:\/\//i.test(href)) {
      setBrowserUrl(href);
      setInspectorTab("browser");
      setInspectorOpen(true);
      return;
    }
    window.open(href, "_blank", "noopener");
  }

  return <MarkdownBody content={content} githubBaseUrl={githubBaseUrl} onOpenFile={handleOpenFile} onOpenLink={handleOpenLink} />;
}

/** Pure renderer shared by conversation and host-backed review content. */
export function MarkdownBody({ content, githubBaseUrl, onOpenFile, onOpenLink }: {
  content: string;
  githubBaseUrl?: string;
  onOpenFile?: (path: string) => void;
  onOpenLink?: (href: string) => void;
}) {
  function renderMarkdown(text: string, depth = 0): ReactNode {
    const sections = githubBaseUrl && depth < 12 ? splitGitHubDetails(text) : [{ kind: "markdown" as const, text }];
    return sections.map((section, sectionIndex) => section.kind === "details" ? (
      <details className="md-details" open={section.open} key={sectionIndex}>
        <summary>{inline(normalizeGitHubMarkdown(section.summary, githubBaseUrl!), undefined, onOpenLink)}</summary>
        <div className="md-details-body">{renderMarkdown(section.text, depth + 1)}</div>
      </details>
    ) : <Fragment key={sectionIndex}>{splitFences(section.text).map((segment, index) =>
        segment.kind === "code" ? (
          <CodeBlock key={index} code={segment.text} language={segment.language} />
        ) : (
          <Fragment key={index}>
            {block(githubBaseUrl ? normalizeGitHubMarkdown(segment.text, githubBaseUrl) : segment.text, index, onOpenFile, onOpenLink, Boolean(githubBaseUrl))}
          </Fragment>
        ),
      )}</Fragment>);
  }
  return <div className="body">{renderMarkdown(content)}</div>;
}
