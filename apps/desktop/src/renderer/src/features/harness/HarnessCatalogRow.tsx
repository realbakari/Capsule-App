import { AgentGlyph } from "../shell/AgentGlyph";
import { CheckIcon } from "../shell/icons";

/** Selection is a check and outline; hover alone must not look selected. */
export function HarnessCatalogRow({ id, name, detail, selected, sessionOpen, onSelect }: {
  id: string;
  name: string;
  detail: string;
  selected: boolean;
  sessionOpen: boolean;
  onSelect: () => void;
}) {
  return <button type="button" className={`harness-catalog-row${selected ? " active" : ""}`}
    aria-pressed={selected} onClick={onSelect}>
    <AgentGlyph id={id} name={name} size={18} />
    <span className="harness-catalog-copy"><b>{name}</b><small>{detail}</small></span>
    <span className="harness-catalog-indicators">
      {sessionOpen && <i className="dot on" aria-label="Session open" />}
      {selected && <CheckIcon size={14} />}
    </span>
  </button>;
}
