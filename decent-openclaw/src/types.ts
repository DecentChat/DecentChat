export type DecentChatChannelConfig = {
  port?: number;
  secret?: string;
  enabled?: boolean;
  dmPolicy?: string;
  channels?: Record<string, { requireMention?: boolean }>;
};

export type ResolvedDecentChatAccount = {
  accountId: string;
  port: number;
  secret?: string;
  enabled: boolean;
  dmPolicy: string;
  configured: boolean;
};

export type WireMessage = {
  type: "message";
  messageId: string;
  channelId: string;
  workspaceId: string;
  senderId: string;
  senderName: string;
  content: string;
  chatType: "channel" | "direct";
  timestamp: number;
  replyToId?: string;
};

export type WireTyping = {
  type: "typing";
  channelId: string;
  messageId: string;
};

export type WireReply = {
  type: "reply";
  inReplyToId: string;
  channelId: string;
  content: string;
  timestamp: number;
};

export type WireCommandAck = {
  type: "command_ack";
  channelId: string;
  text: string;
};

export type WireError = {
  type: "error";
  inReplyToId: string;
  reason: string;
};

export type WirePing = { type: "ping" };
export type WirePong = { type: "pong" };

export type WireAuth = {
  type: "auth";
  secret: string;
};

export type InboundWireMessage = WireMessage | WireAuth | WirePing;
export type OutboundWireMessage = WireTyping | WireReply | WireCommandAck | WireError | WirePong;
