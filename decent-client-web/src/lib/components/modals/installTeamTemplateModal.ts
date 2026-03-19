import { mount, unmount } from 'svelte';
import type {
  CompanyTemplateDefinition,
  CompanyTemplateInstallRequest,
  CompanyTemplateInstallResult,
} from '../../../ui/types';
import InstallTeamTemplateModal from './InstallTeamTemplateModal.svelte';

export interface InstallTeamTemplateModalConfig {
  workspaceId: string | null;
  workspaceName?: string | null;
  listTemplates?: () => Promise<CompanyTemplateDefinition[]> | CompanyTemplateDefinition[];
  installTemplate?: (request: CompanyTemplateInstallRequest) => Promise<CompanyTemplateInstallResult>;
  onInstalled?: (result: CompanyTemplateInstallResult) => void | Promise<void>;
  onToast?: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export function showInstallTeamTemplateModal(config: InstallTeamTemplateModalConfig): void {
  const target = document.createElement('div');
  document.body.appendChild(target);

  let instance: Record<string, any> | null = null;
  const cleanup = () => {
    if (instance) {
      unmount(instance);
      instance = null;
    }
    target.remove();
  };

  instance = mount(InstallTeamTemplateModal, {
    target,
    props: {
      ...config,
      onClose: cleanup,
    },
  });
}
