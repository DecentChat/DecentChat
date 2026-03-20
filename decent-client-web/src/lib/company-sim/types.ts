import type {
  CompanySimDocumentPayload,
  CompanySimEmployeeContext,
  CompanySimRoutingPreview,
  CompanySimState,
} from '../../ui/types';

export type CompanySimSection = 'overview' | 'docs' | 'people' | 'channels' | 'provisioning' | 'sandbox';

export interface CompanySimStateRequest {
  workspaceId: string;
}

export interface CompanySimDocReadRequest {
  workspaceId: string;
  relativePath: string;
}

export interface CompanySimDocWriteRequest extends CompanySimDocReadRequest {
  content: string;
}

export interface CompanySimEmployeeContextRequest {
  workspaceId: string;
  employeeId: string;
}

export interface CompanySimRoutingPreviewRequest {
  workspaceId: string;
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  text: string;
  threadId?: string;
}

export interface CompanySimControlPlaneTransport {
  requestState: (request: CompanySimStateRequest) => Promise<unknown> | unknown;
  readDocument: (request: CompanySimDocReadRequest) => Promise<unknown> | unknown;
  writeDocument: (request: CompanySimDocWriteRequest) => Promise<unknown> | unknown;
  requestEmployeeContext: (request: CompanySimEmployeeContextRequest) => Promise<unknown> | unknown;
  requestRoutingPreview: (request: CompanySimRoutingPreviewRequest) => Promise<unknown> | unknown;
}

export interface CompanySimControlPlaneClient {
  getState: (request: CompanySimStateRequest) => Promise<CompanySimState>;
  readDocument: (request: CompanySimDocReadRequest) => Promise<CompanySimDocumentPayload>;
  writeDocument: (request: CompanySimDocWriteRequest) => Promise<CompanySimDocumentPayload>;
  getEmployeeContext: (request: CompanySimEmployeeContextRequest) => Promise<CompanySimEmployeeContext>;
  getRoutingPreview: (request: CompanySimRoutingPreviewRequest) => Promise<CompanySimRoutingPreview>;
}
