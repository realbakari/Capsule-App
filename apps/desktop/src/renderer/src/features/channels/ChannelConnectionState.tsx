import { createContext, useContext, useState, type ReactNode } from "react";
import { ChannelReactions } from "./channel-reactions";

const ReactionsContext = createContext<ChannelReactions | null>(null);
export function ChannelConnectionState({ children }: { children: ReactNode }) {
  const [reactions] = useState(() => new ChannelReactions());
  return <ReactionsContext.Provider value={reactions}>{children}</ReactionsContext.Provider>;
}
export function useChannelReactions() {
  const shared = useContext(ReactionsContext);
  const [local] = useState(() => new ChannelReactions());
  return shared ?? local;
}
