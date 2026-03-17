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

export interface CompanyEmployeeConfig {
  id: string;
  accountId: string;
  alias: string;
  teamId?: string;
  title: string;
  managerEmployeeId?: string;
  reportsToHumanRole?: string;
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
