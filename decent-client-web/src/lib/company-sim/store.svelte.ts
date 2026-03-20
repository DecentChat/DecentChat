import type {
  CompanySimDocumentPayload,
  CompanySimEmployeeContext,
  CompanySimRoutingPreview,
  CompanySimState,
} from '../../ui/types';
import { shellData } from '../stores/shell.svelte';
import { getCompanySimControlPlaneClient } from './controlPlane';
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


export async function loadCompanySimState(workspaceId: string): Promise<void> {
  const nextWorkspaceId = String(workspaceId ?? '').trim();
  if (!nextWorkspaceId) throw new Error('workspaceId is required to load company sim');
  const client = getCompanySimControlPlaneClient();
  if (!client) throw new Error('Company sim control plane is unavailable');

  companySimStore.loading = true;
  companySimStore.error = null;
  try {
    const state = await client.getState({ workspaceId: nextWorkspaceId });
    companySimStore.activeWorkspaceId = nextWorkspaceId;
    companySimStore.state = state;
    companySimStore.lastLoadedAt = Date.now();
  } catch (error) {
    companySimStore.error = (error as Error).message;
    throw error;
  } finally {
    companySimStore.loading = false;
  }
}

export async function openCompanySimPanel(workspaceId: string, workspaceName?: string | null): Promise<void> {
  shellData.companySim.open = true;
  shellData.companySim.workspaceId = workspaceId;
  shellData.companySim.workspaceName = workspaceName ?? null;
  setCompanySimWorkspace(workspaceId);
  await loadCompanySimState(workspaceId);
}

export function closeCompanySimPanel(): void {
  shellData.companySim.open = false;
}
