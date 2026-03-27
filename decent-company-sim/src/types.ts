export type CompanySimMode = 'company-sim';

export type CompanyParticipationMode =
  | 'summary-first'
  | 'specialist'
  | 'mention-only'
  | 'silent-unless-routed'
  | 'proactive-on-owned-channel';

export interface CompanyParticipationConfig {
  mode: CompanyParticipationMode;
  respondWhenMentioned?: boolean;
  replyInThreadsOnly?: boolean;
  respondToChannelTopics?: string[];
}

export interface CompanyWorkspaceConfig {
  name: string;
  channels: string[];
}

export interface CompanyTeamConfig {
  id: string;
  name: string;
  managerEmployeeId?: string;
}

export interface CompanyEmployeeBindingConfig {
  channel: string;
  accountId?: string;
}

export interface CompanyEmployeeConfig {
  id: string;
  agentId: string;
  accountId: string;
  alias: string;
  teamId?: string;
  title: string;
  managerEmployeeId?: string;
  reportsToHumanRole?: string;
  workspaceDir?: string;
  workspaceName?: string;
  bindings?: CompanyEmployeeBindingConfig[];
  channels: string[];
  participation: CompanyParticipationConfig;
}

export interface CompanyManifest {
  id: string;
  name: string;
  mode: CompanySimMode;
  workspace: CompanyWorkspaceConfig;
  teams: CompanyTeamConfig[];
  employees: CompanyEmployeeConfig[];
}

// ─── Shared types for integration with the plugin host ─────────────────────

/** Minimal account shape needed by company-sim bootstrap and context loaders. */
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

/** Minimal OpenClaw config shape used by company-sim bootstrap. */
export type OpenClawConfigShape = {
  channels?: Record<string, unknown>;
  agents?: {
    list?: OpenClawAgentListEntryConfig[];
    [key: string]: unknown;
  };
  bindings?: OpenClawRouteBindingConfig[];
  [key: string]: unknown;
};

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
