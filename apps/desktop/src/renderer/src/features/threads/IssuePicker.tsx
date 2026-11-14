import { useCallback, useEffect, useMemo, useState } from "react";
import { issueBranchName, issuePrompt, type GithubIssue } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { GitBranchIcon } from "../shell/icons";
import { SearchDialog, type SearchDialogItem } from "../shell/SearchDialog";

/*
 * Start a thread from one of the project's open GitHub issues: its own
 * worktree on a branch named after the issue, with the issue as the first
 * prompt, left in the composer to read and send.
 */
export function IssuePicker({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { api, projects, createTask } = useWorkspace();
  const project = projects.find((item) => item.id === projectId);
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<{ items?: GithubIssue[]; error?: string }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setListing(undefined);
    api.listGithubIssues(projectId)
      .then((result) => { if (current) setListing(result); })
      .catch((error) => { if (current) setListing({ error: formatUserError(error) }); });
    return () => { current = false; };
  }, [api, projectId, attempt]);

  const start = useCallback(async (issue: GithubIssue) => {
    onClose();
    await createTask(projectId, issuePrompt(issue), { title: `#${issue.number} ${issue.title}`, workspaceMode: "worktree", branchName: issueBranchName(issue) });
  }, [createTask, onClose, projectId]);

  const items = useMemo<SearchDialogItem[]>(() => {
    const needle = query.trim().toLowerCase().replace(/^#/, "");
    return (listing?.items ?? [])
      .filter((issue) => !needle || String(issue.number).startsWith(needle) || issue.title.toLowerCase().includes(needle)
        || issue.labels.some((label) => label.toLowerCase().includes(needle)))
      .slice(0, 100)
      .map((issue) => ({
        id: `issue-${issue.number}`,
        label: `#${issue.number} ${issue.title}`,
        detail: [issue.labels.join(", "), issueBranchName(issue)].filter(Boolean).join(" · "),
        group: project ? `Open issues · ${project.name}` : "Open issues",
        icon: <GitBranchIcon size={15} />,
        onSelect: () => start(issue),
      }));
  }, [listing, query, project, start]);

  return (
    <SearchDialog
      title="Start from a GitHub issue"
      placeholder="Search open issues by number, title or label"
      query={query}
      onQueryChange={setQuery}
      items={items}
      status={listing ? undefined : "Loading open issues…"}
      error={listing?.error}
      onRetry={() => setAttempt((value) => value + 1)}
      empty={listing?.items && listing.items.length === 0 ? "This repository has no open issues." : "No open issue matches."}
      selectLabel="Start"
      onClose={onClose}
    />
  );
}
