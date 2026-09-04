import { useMemo, useState } from "react";
import type { GitPullRequest } from "@capsule/shared";
import { visiblePullRequests, type PullRequestSort } from "../../lib/pull-requests";
import { RefreshIcon } from "./icons";

export function PullRequestList({ items, loading, error, onRefresh, onSelect }: {
  items?: GitPullRequest[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onSelect: (item: GitPullRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PullRequestSort>("updated");
  const shown = useMemo(() => visiblePullRequests(items ?? [], query, sort), [items, query, sort]);
  return (
    <section className="codex-pr-list" aria-busy={loading}>
      <div className="codex-pr-list-head">
        <h4>Open pull requests{items ? ` (${items.length})` : ""}</h4>
        <button className="chip" type="button" disabled={loading} onClick={onRefresh}>
          <RefreshIcon size={13} /> {loading ? "Refreshing…" : error ? "Retry" : "Refresh"}
        </button>
      </div>
      <div className="pr-list-filters">
        <input type="search" aria-label="Filter pull requests" placeholder="Filter by title, author, branch, or number" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Sort pull requests" value={sort} onChange={(event) => setSort(event.target.value as PullRequestSort)}>
          <option value="updated">Recently updated</option>
          <option value="created">Newest created</option>
        </select>
      </div>
      {error ? <p className="notice" role="alert">{error}{items ? " Showing the last successful result." : ""}</p> : null}
      {!loading && items?.length === 0 && !error ? <p className="faint">No open pull requests were found for this repository.</p> : null}
      {items && items.length > 0 && shown.length === 0 ? <p className="faint">No loaded pull requests match this filter.</p> : null}
      {shown.map((item) => (
        <button className="codex-pr-row" type="button" key={item.number} onClick={() => onSelect(item)}>
          <span className="codex-pr-number">#{item.number}</span>
          <span className="codex-pr-copy">
            <b>{item.title}</b>
            <small>{[item.author, item.headRefName].filter(Boolean).join(" · ") || "Open pull request"}</small>
          </span>
          <span className={`codex-pr-checks ${item.checks ?? "none"}`}>{item.isDraft ? "Draft" : item.checks ?? "Open"}</span>
        </button>
      ))}
      {items && items.length >= 50 ? <p className="faint">Showing the first 50 open pull requests. Filters apply to these results.</p> : null}
    </section>
  );
}
