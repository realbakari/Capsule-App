import "./backdrop.css";

/** The layer the theme's backdrop is drawn on. Hidden unless a backdrop is set. */
export function ConversationBackdrop() {
  return <div className="conversation-backdrop" aria-hidden="true" />;
}
