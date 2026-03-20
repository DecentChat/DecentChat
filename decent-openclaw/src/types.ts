
export type OpenClawAgentListEntryConfig = {
  id?: string;
  workspace?: string;
  [key: string]: unknown;
};

export type OpenClawRouteBindingConfig = {
  type?: string;
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
  };
  [key: string]: unknown;
};

export type OpenClawConfigShape = {
  channels?: Record<string, unknown>;
  agents?: {
    list?: OpenClawAgentListEntryConfig[];
    [key: string]: unknown;
  };
  bindings?: OpenClawRouteBindingConfig[];
  [key: string]: unknown;
};

export type DecentChatCompanySimBootstrapConfig = {
  enabled?: boolean;
  mode?: 'runtime' | 'off';
  manifestPath?: string;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
};

export type DecentChatCompanySimConfig = {
  enabled?: boolean;
  manifestPath?: string;
  companyId?: string;
  employeeId?: string;
  roleFilesDir?: string;
  silentChannelIds?: string[];
};

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
    sttEngine?: 'whisper-cpp' | 'whisper-python' | 'openai' | 'groq';
    whisperModel?: string;
    sttLanguage?: string;
    sttApiKey?: string;
    ttsVoice?: string;
    vadSilenceMs?: number;
    vadThreshold?: number;
  };
  companySim?: DecentChatCompanySimConfig;
  companySimBootstrap?: DecentChatCompanySimBootstrapConfig;
  companySimBootstrapEnabled?: boolean;
  companySimBootstrapMode?: 'runtime' | 'off';
  companySimBootstrapManifestPath?: string;
  companySimBootstrapTargetWorkspaceId?: string;
  companySimBootstrapTargetInviteCode?: string;
  defaultAccount?: string;
  accounts?: Record<string, Omit<DecentChatChannelConfig, 'accounts'>>;
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
    sttEngine?: 'whisper-cpp' | 'whisper-python' | 'openai' | 'groq';
    whisperModel?: string;
    sttLanguage?: string;
    sttApiKey?: string;
    ttsVoice?: string;
    vadSilenceMs?: number;
    vadThreshold?: number;
  };
  companySim?: {
    enabled: boolean;
    manifestPath?: string;
    companyId?: string;
    employeeId?: string;
    roleFilesDir?: string;
    silentChannelIds?: string[];
  };
  companySimBootstrap?: {
    enabled: boolean;
    mode: 'runtime' | 'off';
    manifestPath?: string;
    targetWorkspaceId?: string;
    targetInviteCode?: string;
  };
};
