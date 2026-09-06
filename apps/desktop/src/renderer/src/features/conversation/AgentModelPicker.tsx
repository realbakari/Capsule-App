import type { Agent, HarnessStatus, AcpModelCatalog, FeatureAvailability } from "@capsule/shared";
import { agentPickerDetail } from "../../lib/harness";
import { MenuSelect, type MenuOption } from "../shell/MenuSelect";
import { AgentGlyph } from "../shell/AgentGlyph";

/** One identity control: choose the agent, then only models it actually reports. */
export function AgentModelPicker(props: {
  agents: Agent[];
  harnesses: HarnessStatus[];
  agentId: string;
  liveHarnessId?: string;
  models?: AcpModelCatalog;
  currentModel: string;
  availability: FeatureAvailability;
  onAgent: (id: string) => void;
  onModel: (id: string) => void;
}) {
  const agent = props.agents.find((item) => item.id === props.agentId);
  const knownModel = props.models?.availableModels.find((item) => item.modelId === props.currentModel);
  const options: MenuOption[] = props.agents.map((item) => ({
    id: `agent:${item.id}`,
    label: item.name,
    group: "Agents",
    detail: agentPickerDetail({
      harness: props.harnesses.find((harness) => harness.id === item.id),
      description: item.description,
      live: props.liveHarnessId === item.id,
    }),
    icon: <AgentGlyph id={item.id} name={item.name} />,
  }));
  if (props.harnesses.some((item) => item.id === props.agentId)) {
    const models = props.models?.availableModels ?? [];
    const group = `Models · ${agent?.name ?? "Selected agent"}`;
    options.push(...(models.length ? models.map((item) => ({
      id: `model:${item.modelId}`,
      label: item.name,
      group,
      disabledReason: props.availability.state === "unavailable" ? props.availability.detail : undefined,
    })) : [{ id: "models-unavailable", label: "Models unavailable", group, disabledReason: props.availability.detail }]));
  }
  return <MenuSelect
    ariaLabel="Agent and model"
    value={knownModel ? `model:${knownModel.modelId}` : `agent:${props.agentId}`}
    icon={agent ? <AgentGlyph id={agent.id} name={agent.name} /> : undefined}
    options={options}
    onChange={(id) => {
      if (id.startsWith("agent:")) props.onAgent(id.slice(6));
      else if (id.startsWith("model:")) props.onModel(id.slice(6));
    }}
  />;
}
