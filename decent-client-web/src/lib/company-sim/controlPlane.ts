import type {
  CompanySimChannelRecord,
  CompanySimDocRecord,
  CompanySimDocumentPayload,
  CompanySimEmployeeContext,
  CompanySimEmployeeContextSection,
  CompanySimEmployeeParticipation,
  CompanySimEmployeeRecord,
  CompanySimOverview,
  CompanySimProvisioningState,
  CompanySimRoutingPreview,
  CompanySimRoutingPreviewEntry,
  CompanySimState,
  CompanySimTeamRecord,
} from '../../ui/types';
import type {
  CompanySimControlPlaneClient,
  CompanySimControlPlaneTransport,
  CompanySimDocReadRequest,
  CompanySimDocWriteRequest,
  CompanySimEmployeeContextRequest,
  CompanySimRoutingPreviewRequest,
  CompanySimStateRequest,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => (typeof value === 'string' ? value : String(value ?? '')))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function normalizeOverview(value: unknown, workspaceId: string): CompanySimOverview {
  const payload = isRecord(value) ? value : {};
  const counts = isRecord(payload.counts) ? payload.counts : {};
  const readState = (raw: unknown): CompanySimOverview['sourceState'] =>
    raw === 'ready' || raw === 'warning' ? raw : 'unknown';

  return {
    workspaceId: readString(payload.workspaceId, workspaceId),
    ...(readOptionalString(payload.workspaceName) ? { workspaceName: readOptionalString(payload.workspaceName) } : {}),
    companyId: readString(payload.companyId, ''),
    companyName: readString(payload.companyName, ''),
    manifestPath: readString(payload.manifestPath, ''),
    companyDirPath: readString(payload.companyDirPath, ''),
    counts: {
      employees: Number.isFinite(counts.employees) ? Number(counts.employees) : 0,
      teams: Number.isFinite(counts.teams) ? Number(counts.teams) : 0,
      channels: Number.isFinite(counts.channels) ? Number(counts.channels) : 0,
      docs: Number.isFinite(counts.docs) ? Number(counts.docs) : 0,
    },
    sourceState: readState(payload.sourceState),
    generatedState: readState(payload.generatedState),
    liveState: readState(payload.liveState),
    warnings: uniqueStrings(payload.warnings),
  };
}

function normalizeDocRecord(value: unknown): CompanySimDocRecord {
  const payload = isRecord(value) ? value : {};
  return {
    id: readString(payload.id, ''),
    relativePath: readString(payload.relativePath, ''),
    ...(readOptionalString(payload.absolutePath) ? { absolutePath: readOptionalString(payload.absolutePath) } : {}),
    label: readString(payload.label, ''),
    kind: payload.kind === 'team' || payload.kind === 'employee' ? payload.kind : 'company',
    required: payload.required === true,
    exists: payload.exists === true,
    usedByEmployeeIds: uniqueStrings(payload.usedByEmployeeIds),
    ...(readOptionalString(payload.teamId) ? { teamId: readOptionalString(payload.teamId) } : {}),
    ...(readOptionalString(payload.employeeId) ? { employeeId: readOptionalString(payload.employeeId) } : {}),
    ...(readOptionalString(payload.documentId) ? { documentId: readOptionalString(payload.documentId) } : {}),
  };
}

function normalizeTeamRecord(value: unknown): CompanySimTeamRecord {
  const payload = isRecord(value) ? value : {};
  return {
    id: readString(payload.id, ''),
    name: readString(payload.name, ''),
    ...(readOptionalString(payload.managerEmployeeId) ? { managerEmployeeId: readOptionalString(payload.managerEmployeeId) } : {}),
    memberEmployeeIds: uniqueStrings(payload.memberEmployeeIds),
    docPath: readString(payload.docPath, ''),
    docExists: payload.docExists === true,
  };
}

function normalizeParticipation(value: unknown): CompanySimEmployeeParticipation {
  const payload = isRecord(value) ? value : {};
  return {
    ...(readOptionalString(payload.mode) ? { mode: payload.mode as CompanySimEmployeeParticipation['mode'] } : {}),
    ...(typeof payload.respondWhenMentioned === 'boolean' ? { respondWhenMentioned: payload.respondWhenMentioned } : {}),
    ...(typeof payload.replyInThreadsOnly === 'boolean' ? { replyInThreadsOnly: payload.replyInThreadsOnly } : {}),
    ...(Array.isArray(payload.respondToChannelTopics) ? { respondToChannelTopics: uniqueStrings(payload.respondToChannelTopics) } : {}),
  };
}

function normalizeEmployeeRecord(value: unknown): CompanySimEmployeeRecord {
  const payload = isRecord(value) ? value : {};
  return {
    id: readString(payload.id, ''),
    accountId: readString(payload.accountId, ''),
    alias: readString(payload.alias, ''),
    title: readString(payload.title, ''),
    ...(readOptionalString(payload.teamId) ? { teamId: readOptionalString(payload.teamId) } : {}),
    ...(readOptionalString(payload.managerEmployeeId) ? { managerEmployeeId: readOptionalString(payload.managerEmployeeId) } : {}),
    channels: uniqueStrings(payload.channels),
    participation: normalizeParticipation(payload.participation),
    silentChannelIds: uniqueStrings(payload.silentChannelIds),
    effectiveDocPaths: uniqueStrings(payload.effectiveDocPaths),
  };
}

function normalizeChannelRecord(value: unknown): CompanySimChannelRecord {
  const payload = isRecord(value) ? value : {};
  return {
    name: readString(payload.name, ''),
    memberEmployeeIds: uniqueStrings(payload.memberEmployeeIds),
    mutedEmployeeIds: uniqueStrings(payload.mutedEmployeeIds),
  };
}

function normalizeProvisioningState(value: unknown): CompanySimProvisioningState {
  const payload = isRecord(value) ? value : {};
  return {
    bootstrapEnabled: payload.bootstrapEnabled === true,
    bootstrapMode: payload.bootstrapMode === 'runtime' || payload.bootstrapMode === 'off'
      ? payload.bootstrapMode
      : null,
    manifestPath: readString(payload.manifestPath, ''),
    ...(readOptionalString(payload.targetWorkspaceId) ? { targetWorkspaceId: readOptionalString(payload.targetWorkspaceId) } : {}),
    ...(readOptionalString(payload.targetInviteCode) ? { targetInviteCode: readOptionalString(payload.targetInviteCode) } : {}),
    configuredAccountIds: uniqueStrings(payload.configuredAccountIds),
    missingAccountIds: uniqueStrings(payload.missingAccountIds),
    onlineReadyAccountIds: uniqueStrings(payload.onlineReadyAccountIds),
    manualActionRequiredAccountIds: uniqueStrings(payload.manualActionRequiredAccountIds),
  };
}

export function normalizeCompanySimState(value: unknown, workspaceId: string): CompanySimState {
  const payload = isRecord(value) ? value : {};
  return {
    overview: normalizeOverview(payload.overview, workspaceId),
    teams: Array.isArray(payload.teams) ? payload.teams.map(normalizeTeamRecord) : [],
    employees: Array.isArray(payload.employees) ? payload.employees.map(normalizeEmployeeRecord) : [],
    channels: Array.isArray(payload.channels) ? payload.channels.map(normalizeChannelRecord) : [],
    docs: Array.isArray(payload.docs) ? payload.docs.map(normalizeDocRecord) : [],
    provisioning: normalizeProvisioningState(payload.provisioning),
  };
}

export function normalizeCompanySimDocumentPayload(value: unknown): CompanySimDocumentPayload {
  const payload = isRecord(value) ? value : {};
  return {
    doc: normalizeDocRecord(payload.doc),
    content: readString(payload.content, ''),
  };
}

function normalizeContextSection(value: unknown): CompanySimEmployeeContextSection {
  const payload = isRecord(value) ? value : {};
  return {
    id: readString(payload.id, ''),
    title: readString(payload.title, ''),
    relativePath: readString(payload.relativePath, ''),
    content: readString(payload.content, ''),
  };
}

export function normalizeCompanySimEmployeeContext(value: unknown): CompanySimEmployeeContext {
  const payload = isRecord(value) ? value : {};
  return {
    employeeId: readString(payload.employeeId, ''),
    alias: readString(payload.alias, ''),
    sections: Array.isArray(payload.sections) ? payload.sections.map(normalizeContextSection) : [],
    prompt: readString(payload.prompt, ''),
  };
}

function normalizeRoutingEntry(value: unknown): CompanySimRoutingPreviewEntry {
  const payload = isRecord(value) ? value : {};
  return {
    employeeId: readString(payload.employeeId, ''),
    alias: readString(payload.alias, ''),
    title: readString(payload.title, ''),
    ...(readOptionalString(payload.teamId) ? { teamId: readOptionalString(payload.teamId) } : {}),
    shouldRespond: payload.shouldRespond === true,
    reason: readString(payload.reason, ''),
    preferredReply: payload.preferredReply === 'channel' ? 'channel' : 'thread',
    explanation: readString(payload.explanation, ''),
  };
}

export function normalizeCompanySimRoutingPreview(value: unknown, request: CompanySimRoutingPreviewRequest): CompanySimRoutingPreview {
  const payload = isRecord(value) ? value : {};
  return {
    workspaceId: readString(payload.workspaceId, request.workspaceId),
    companyId: readString(payload.companyId, ''),
    chatType: payload.chatType === 'direct' ? 'direct' : request.chatType,
    ...(readOptionalString(payload.channelNameOrId) || request.channelNameOrId
      ? { channelNameOrId: readOptionalString(payload.channelNameOrId) ?? request.channelNameOrId }
      : {}),
    text: readString(payload.text, request.text),
    ...(readOptionalString(payload.threadId) || request.threadId
      ? { threadId: readOptionalString(payload.threadId) ?? request.threadId }
      : {}),
    responders: Array.isArray(payload.responders) ? payload.responders.map(normalizeRoutingEntry) : [],
    suppressed: Array.isArray(payload.suppressed) ? payload.suppressed.map(normalizeRoutingEntry) : [],
  };
}

let companySimControlPlaneTransport: CompanySimControlPlaneTransport | null = null;

export function setCompanySimControlPlaneTransport(transport: CompanySimControlPlaneTransport | null): void {
  companySimControlPlaneTransport = transport;
}

export function getCompanySimControlPlaneTransport(): CompanySimControlPlaneTransport | null {
  return companySimControlPlaneTransport;
}

export function createCompanySimControlPlaneClient(
  transport: CompanySimControlPlaneTransport,
): CompanySimControlPlaneClient {
  return {
    getState: async (request: CompanySimStateRequest) => normalizeCompanySimState(await transport.requestState(request), request.workspaceId),
    readDocument: async (request: CompanySimDocReadRequest) => normalizeCompanySimDocumentPayload(await transport.readDocument(request)),
    writeDocument: async (request: CompanySimDocWriteRequest) => normalizeCompanySimDocumentPayload(await transport.writeDocument(request)),
    getEmployeeContext: async (request: CompanySimEmployeeContextRequest) => normalizeCompanySimEmployeeContext(await transport.requestEmployeeContext(request)),
    getRoutingPreview: async (request: CompanySimRoutingPreviewRequest) => normalizeCompanySimRoutingPreview(await transport.requestRoutingPreview(request), request),
  };
}

export function getCompanySimControlPlaneClient(): CompanySimControlPlaneClient | null {
  if (!companySimControlPlaneTransport) return null;
  return createCompanySimControlPlaneClient(companySimControlPlaneTransport);
}
