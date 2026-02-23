export type DecentChatChannelConfig = {
  enabled?: boolean;
  dmPolicy?: string;
  seedPhrase?: string;
  signalingServer?: string;
  invites?: string[];
  alias?: string;
  dataDir?: string;
  channels?: Record<string, { requireMention?: boolean }>;
  streamEnabled?: boolean;
};

export type ResolvedDecentChatAccount = {
  accountId: string;
  enabled: boolean;
  dmPolicy: string;
  configured: boolean;
  seedPhrase?: string;
  signalingServer?: string;
  invites: string[];
  alias: string;
  dataDir?: string;
  streamEnabled: boolean;
};
