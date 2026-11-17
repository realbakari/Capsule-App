/**
 * ⇧⌘P, ⇧⌘M and ⇧⌘E open the composer's own permissions, model and effort
 * controls, found by the names they already carry, so a shortcut does exactly
 * what a click would on either runtime route. A control drawn in the composer
 * (the model picker, a Permissions chip or the row under a new conversation)
 * is pressed directly; the rest sit inside the model picker, whose trigger
 * lists them so the answer is known before it opens.
 */
export const COMPOSER_CONTROLS = {
  mode: { labels: ["Permissions"], name: "permissions" },
  model: { labels: ["Agent and model"], name: "model" },
  effort: { labels: ["Reasoning effort"], name: "reasoning effort" },
} as const;

export type ComposerControl = keyof typeof COMPOSER_CONTROLS;

const PICKER = '.composer button[aria-label="Agent and model"]';

/** Open the control, or say why it cannot be opened. */
export function openComposerControl(kind: ComposerControl, root: ParentNode = document): string | undefined {
  const { labels, name } = COMPOSER_CONTROLS[kind];
  for (const label of labels) {
    const trigger = root.querySelector<HTMLButtonElement>(`.composer button[aria-label="${label}"], .composer button[data-setting="${label}"]`);
    if (trigger && trigger.getClientRects().length) return press(trigger, name);
  }
  const picker = root.querySelector<HTMLButtonElement>(PICKER);
  const offered = picker?.dataset.settings?.split("|") ?? [];
  const label = labels.find((item) => offered.includes(item));
  if (!picker || !label) return `This agent does not offer a ${name} choice here.`;
  if (picker.getAttribute("aria-expanded") !== "true") {
    const reason = press(picker, name);
    if (reason) return reason;
  }
  /* The picker renders its settings once it opens; reach in after that frame. A popover trigger opens; a column of rows takes focus on its current row. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const setting = document.querySelector<HTMLElement>(`.agent-model-picker [data-setting="${label}"]`);
    if (!(setting instanceof HTMLButtonElement)) { setting?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(); return; }
    setting.focus();
    if (setting.getAttribute("aria-disabled") !== "true" && setting.getAttribute("aria-expanded") !== "true") setting.click();
  }));
  return undefined;
}

function press(trigger: HTMLButtonElement, name: string): string | undefined {
  if (trigger.disabled || trigger.getAttribute("aria-disabled") === "true") {
    return trigger.getAttribute("aria-description") ?? trigger.title ?? `The ${name} cannot be changed right now.`;
  }
  if (!trigger.getClientRects().length) return `Return to the latest message to change the ${name}.`;
  trigger.focus();
  trigger.click();
  return undefined;
}
