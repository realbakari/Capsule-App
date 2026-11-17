import { useSyncExternalStore } from "react";

/**
 * Notes a reader leaves on diff lines in Review, held per thread until they
 * go to the composer as one block. `side` says which version the line number
 * counts in: "left" is the old file, "right" the new one.
 */
export interface ReviewComment {
  id: string;
  path: string;
  line: number;
  side: "left" | "right";
  text: string;
}

/* Per thread, for this window's life: a note is a draft, not a record. */
const threads = new Map<string, readonly ReviewComment[]>();
const listeners = new Set<() => void>();
const NONE: readonly ReviewComment[] = [];
let sequence = 0;

function set(thread: string, next: readonly ReviewComment[]): void {
  if (next.length) threads.set(thread, next); else threads.delete(thread);
  for (const listener of listeners) listener();
}

export function reviewComments(thread: string): readonly ReviewComment[] {
  return threads.get(thread) ?? NONE;
}

export function addReviewComment(thread: string, comment: Omit<ReviewComment, "id">): void {
  sequence += 1;
  set(thread, [...reviewComments(thread), { ...comment, id: `note-${sequence}` }]);
}

export function editReviewComment(thread: string, id: string, text: string): void {
  set(thread, reviewComments(thread).map((comment) => comment.id === id ? { ...comment, text } : comment));
}

export function removeReviewComment(thread: string, id: string): void {
  set(thread, reviewComments(thread).filter((comment) => comment.id !== id));
}

export function clearReviewComments(thread: string): void {
  set(thread, NONE);
}

export function useReviewComments(thread: string): readonly ReviewComment[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => reviewComments(thread));
}

function where(comment: ReviewComment): string {
  return `${comment.path}:${comment.line}${comment.side === "left" ? " (removed line)" : ""}`;
}

/** The block the composer receives: one line per note, in file and line order. */
export function reviewCommentsBlock(comments: readonly ReviewComment[]): string {
  const ordered = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const lines = ordered.map((comment) => {
    const [first = "", ...rest] = comment.text.trim().split("\n");
    return [`- ${where(comment)} — ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
  });
  return ["Review comments:", ...lines].join("\n");
}
