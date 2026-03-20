import type {
  CompanySimDocumentPayload,
  CompanySimEmployeeContext,
  CompanySimRoutingPreview,
  CompanySimState,
} from '../../ui/types';
import type { CompanySimSection } from './types';

export const companySimStore = $state({
  activeWorkspaceId: null as string | null,
  activeSection: 'overview' as CompanySimSection,
  selectedDocPath: null as string | null,
  selectedEmployeeId: null as string | null,
  selectedChannelName: null as string | null,
  loading: false,
  saving: false,
  applying: false,
  simulating: false,
  error: null as string | null,
  state: null as CompanySimState | null,
  activeDocument: null as CompanySimDocumentPayload | null,
  activeEmployeeContext: null as CompanySimEmployeeContext | null,
  activeRoutingPreview: null as CompanySimRoutingPreview | null,
  lastLoadedAt: 0,
});

export function resetCompanySimStore(): void {
  companySimStore.activeWorkspaceId = null;
  companySimStore.activeSection = 'overview';
  companySimStore.selectedDocPath = null;
  companySimStore.selectedEmployeeId = null;
  companySimStore.selectedChannelName = null;
  companySimStore.loading = false;
  companySimStore.saving = false;
  companySimStore.applying = false;
  companySimStore.simulating = false;
  companySimStore.error = null;
  companySimStore.state = null;
  companySimStore.activeDocument = null;
  companySimStore.activeEmployeeContext = null;
  companySimStore.activeRoutingPreview = null;
  companySimStore.lastLoadedAt = 0;
}

export function setCompanySimWorkspace(workspaceId: string | null): void {
  companySimStore.activeWorkspaceId = workspaceId;
}

export function setCompanySimSection(section: CompanySimSection): void {
  companySimStore.activeSection = section;
}
