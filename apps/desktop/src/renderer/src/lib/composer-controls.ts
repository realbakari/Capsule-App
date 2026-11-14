/**
 * ⇧⌘M, ⇧⌘I and ⇧⌘E open the composer's own mode, model and effort controls,
 * found by the names they already carry, so a shortcut does exactly what a
 * click would on either runtime route. Which control exists depends on the
 * agent: the first label present wins.
 */
export const COMPOSER_CONTROLS = {
  mode: { labels: ["Approvals", "Agent permissions", "Agent mode"], name: "mode" },
  model: { labels: ["Agent and model"], name: "model" },
  effort: { labels: ["Reasoning effort"], name: "reasoning effort" },
} as const;

export type ComposerControl = keyof typeof COMPOSER_CONTROLS;

/** Open the control, or say why it cannot be opened. */
export function openComposerControl(kind: ComposerControl, root: ParentNode = document): string | undefined {
  const { labels, name } = COMPOSER_CONTROLS[kind];
  for (const label of labels) {
    const trigger = root.querySelector<HTMLButtonElement>(`.composer button[aria-label="${label}"]`);
    if (!trigger) continue;
    if (trigger.disabled || trigger.getAttribute("aria-disabled") === "true") {
      return trigger.getAttribute("aria-description") ?? trigger.title ?? `The ${name} cannot be changed right now.`;
    }
    if (!trigger.getClientRects().length) return `Return to the latest message to change the ${name}.`;
    trigger.focus();
    trigger.click();
    return undefined;
  }
  return `This agent does not offer a ${name} choice here.`;
}
