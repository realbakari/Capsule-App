import type { KeyboardEvent } from "react";
import { CheckIcon } from "../shell/icons";

export type Choice = { value: string; name: string; description?: string };

/* Agents name options in lowercase ("high"); menus use sentence case. Word by word would turn "iOS" into "IOS". */
export function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * One agent setting as a column of rows with a check on the current one: the
 * picker's effort levels, and the agent's own modes in the Permissions popover.
 * The group is one tab stop; Up and Down move between its rows.
 */
export function ChoiceRows(props: {
  label: string; choices: readonly Choice[]; current?: string;
  /** Why the rows cannot be picked right now; they stay focusable so the reason can be read. */
  unavailableReason?: string;
  onPick: (value: string) => void;
}) {
  const tabStop = props.choices.some((choice) => choice.value === props.current) ? props.current : props.choices[0]?.value;
  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  }
  return <div role="radiogroup" aria-label={props.label} data-setting={props.label} className="choice-rows" onKeyDown={move}>
    {props.choices.map((choice) => {
      const checked = choice.value === props.current;
      return <button type="button" role="radio" key={choice.value} className="choice-row" aria-checked={checked}
        aria-disabled={props.unavailableReason ? true : undefined} tabIndex={choice.value === tabStop ? 0 : -1}
        title={props.unavailableReason ?? choice.description}
        onClick={() => { if (!props.unavailableReason && !checked) props.onPick(choice.value); }}>
        <span>{sentenceCase(choice.name)}</span>{checked ? <CheckIcon size={14} /> : null}
      </button>;
    })}
  </div>;
}
