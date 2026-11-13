import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ForkBranchGroup } from "@capsule/shared";
import { ChevronDownIcon, ChevronRightIcon, GitBranchIcon } from "../../shell/icons";
import { branchMeta } from "./branch-labels";

/**
 * Where a thread forked. Sits under the turn the branches share, says which
 * branch this is and lets the user step to a sibling or pick one from a list
 * that tells them apart. The original is always first.
 */
export function BranchSwitcher({ group, onOpen }: { group: ForkBranchGroup; onOpen: (sessionId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(group.currentIndex);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const { branches, currentIndex } = group;
  const current = branches[currentIndex];
  const previous = branches[currentIndex - 1];
  const next = branches[currentIndex + 1];
  const original = branches.find((branch) => branch.original);

  useEffect(() => { if (open) { setActive(currentIndex); list.current?.focus(); } }, [open, currentIndex]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !list.current?.parentElement?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (index: number) => {
    const branch = branches[index];
    setOpen(false);
    if (branch && index !== currentIndex) onOpen(branch.sessionId);
    else trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + branches.length) % branches.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : branches.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };
  if (!current) return null;

  return (
    <div className="branch-point" role="group" aria-label="Branches from this turn">
      <span className="branch-point-mark" aria-hidden><GitBranchIcon size={13} /></span>
      <button type="button" className="icon-btn branch-step" disabled={!previous} onClick={() => previous && onOpen(previous.sessionId)}
        aria-label={previous ? `Previous branch: ${previous.title}` : "No previous branch"} title={previous?.title}>
        <ChevronRightIcon size={13} className="branch-step-flip" />
      </button>
      <button ref={trigger} type="button" className="branch-point-current" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}>
        <span className="branch-point-count">Branch {currentIndex + 1} of {branches.length}</span>
        <span className="branch-point-title">{current.original ? "Original" : current.title}</span>
        <ChevronDownIcon size={12} />
      </button>
      <button type="button" className="icon-btn branch-step" disabled={!next} onClick={() => next && onOpen(next.sessionId)}
        aria-label={next ? `Next branch: ${next.title}` : "No next branch"} title={next?.title}>
        <ChevronRightIcon size={13} />
      </button>
      {!current.original && original ? (
        <button type="button" className="ghost branch-point-back" onClick={() => onOpen(original.sessionId)}>Back to original</button>
      ) : null}
      {open && (
        <ul ref={list} id={listId} className="branch-point-list" role="listbox" tabIndex={-1} aria-label="Branches from this turn"
          aria-activedescendant={`${listId}-${active}`} onKeyDown={onKeyDown}>
          {branches.map((branch, index) => (
            <li key={branch.sessionId} id={`${listId}-${index}`} role="option" aria-selected={index === currentIndex}
              data-active={index === active ? "true" : undefined} onMouseMove={() => { if (active !== index) setActive(index); }} onClick={() => choose(index)}>
              <span className="branch-point-option-title">{branch.title}</span>
              <span className="branch-point-option-meta">{branchMeta(branch)}{index === currentIndex ? " · you are here" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
