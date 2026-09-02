import type { CSSProperties } from "react";

import { agentAccent, agentInitials, providerMark } from "../../lib/agent-glyph";

/** The mark that identifies an agent in the composer and its picker. */
export function AgentGlyph({ id, name, size = 14 }: { id: string | undefined; name: string; size?: number }) {
  const mark = providerMark(id);
  const accent = agentAccent(id);
  const style = accent ? ({ "--agent-accent": accent } as CSSProperties) : undefined;

  if (mark) {
    return (
      <svg
        className="agent-mark"
        style={style}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d={mark.path} />
      </svg>
    );
  }
  return (
    <span className="agent-glyph" style={style} aria-hidden>
      {agentInitials(name)}
    </span>
  );
}
