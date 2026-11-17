import { useMemo, type CSSProperties } from "react";
import { highlightLines } from "../../lib/highlight";

/**
 * Highlighted text with a line-number gutter. The numbers are drawn by CSS
 * from `data-line`, so the element's text is still exactly the file's text:
 * a selection, a copy and any offset read from the DOM never pick them up.
 */
export function CodeLines({ text, language, target }: { text: string; language?: string; target?: number }) {
  const lines = useMemo(() => highlightLines(text, language), [text, language]);
  // A final newline ends the last line rather than starting an empty one.
  const shown = lines.length > 1 && text.endsWith("\n") ? lines.length - 1 : lines.length;
  return (
    <span className="code-lines" style={{ "--line-digits": String(shown).length } as CSSProperties}>
      {lines.slice(0, shown).map((line, index) => (
        <span key={index} className="code-line" data-line={index + 1} data-target={index + 1 === target ? "" : undefined}>
          {line}
          {index < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </span>
  );
}
