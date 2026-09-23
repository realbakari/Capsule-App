/** Shared collaboration is separate from local agent sessions and paired viewers. */
export interface RelayConnectionInput { url: string; privateKey: string; remember?: boolean }
export interface RelayConnectionStatus { connected: boolean; url?: string; remembered?: boolean; hasSaved?: boolean; canRemember?: boolean; warning?: string }
export interface SharedChannel { id: string; name: string; description: string; joined: boolean }
export interface ChannelMember { pubkey: string; name: string; role: string; picture?: string }
export interface SharedChannelDetails {
  id: string; name: string; description: string; visibility?: "public" | "private";
  channelType?: string; archived: boolean; topic?: string; purpose?: string;
}
export interface ChannelUpdate { channelId: string; name: string; description: string }
export type ChannelManagementAction = "archive" | "unarchive" | "delete";
export interface ChannelReaction { emoji: string; count: number; mine?: boolean }
export interface ChannelMessage {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  rootId?: string;
  replyTo?: string;
  mentions?: string[];
}
export interface ChannelPost {
  channelId: string;
  content: string;
  replyTo?: string;
  mentions: string[];
}
export interface NewSharedChannel { name: string; description: string; visibility: "private" | "open" }
export interface ChannelInvitation { channelId: string; pubkey: string; role: "member" | "bot" }
