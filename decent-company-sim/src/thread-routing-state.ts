import { buildEmployeeMentionTokens, extractHandoffTargetToken, extractTaskOwnerToken } from './participation.ts';
import type { CompanyManifest } from './types.ts';

export interface CompanyThreadRoutingState {
  assignedEmployeeId: string;
  source: 'task-owner' | 'handoff-target';
}

function resolveEmployeeIdByToken(manifest: CompanyManifest, token: string | null): string | null {
  if (!token) return null;

  for (const employee of manifest.employees) {
    const known = buildEmployeeMentionTokens(employee);
    if (known.has(token)) return employee.id;
  }

  return null;
}

export function resolveThreadRoutingStateUpdate(params: {
  manifest: CompanyManifest;
  text: string;
}): CompanyThreadRoutingState | null {
  const taskOwnerToken = extractTaskOwnerToken(params.text);
  const taskOwnerEmployeeId = resolveEmployeeIdByToken(params.manifest, taskOwnerToken);
  if (taskOwnerEmployeeId) {
    return {
      assignedEmployeeId: taskOwnerEmployeeId,
      source: 'task-owner',
    };
  }

  const handoffTargetToken = extractHandoffTargetToken(params.text);
  const handoffTargetEmployeeId = resolveEmployeeIdByToken(params.manifest, handoffTargetToken);
  if (handoffTargetEmployeeId) {
    return {
      assignedEmployeeId: handoffTargetEmployeeId,
      source: 'handoff-target',
    };
  }

  return null;
}
