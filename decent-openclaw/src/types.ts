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
  replyToMode?: "off" | "first" | "all";
  replyToModeByChatType?: {
    direct?: "off" | "first" | "all";
    group?: "off" | "first" | "all";
    channel?: "off" | "first" | "all";
  };
  thread?: {
    historyScope?: "thread" | "channel";
    inheritParent?: boolean;
    initialHistoryLimit?: number;
  };
  huddle?: {
    enabled?: boolean;
    autoJoin?: boolean;
    sttEngine?: 'whisper-cpp' | 'whisper-python';
    whisperModel?: string;
    ttsVoice?: string;
    vadSilenceMs?: number;
    vadThreshold?: number;
  };
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
  replyToMode: "off" | "first" | "all";
  replyToModeByChatType: {
    direct?: "off" | "first" | "all";
    group?: "off" | "first" | "all";
    channel?: "off" | "first" | "all";
  };
  thread: {
    historyScope: "thread" | "channel";
    inheritParent: boolean;
    initialHistoryLimit: number;
  };
  huddle?: {
    enabled?: boolean;
    autoJoin?: boolean;
    sttEngine?: 'whisper-cpp' | 'whisper-python';
    whisperModel?: string;
    ttsVoice?: string;
    vadSilenceMs?: number;
    vadThreshold?: number;
  };
};
