import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { buildCompanyBootstrapPlan } from '../../src/company-sim/bootstrap.ts';
import { resolveDecentChatAccount } from '../../src/channel.ts';

const manifestPath = fileURLToPath(new URL('../../../company-sims/software-studio/company.yaml', import.meta.url));

const cfg = {
  channels: {
    decentchat: {
      accounts: {
        'team-manager': {
          seedPhrase: 'seed-manager',
          alias: 'Mira PM',
          companySim: {
            enabled: true,
            manifestPath,
            companyId: 'software-studio',
            employeeId: 'team-manager',
          },
        },
        'backend-dev': {
          seedPhrase: 'seed-backend',
          alias: 'Rian Backend',
          companySim: {
            enabled: true,
            manifestPath,
            companyId: 'software-studio',
            employeeId: 'backend-dev',
          },
        },
        tester: {
          seedPhrase: 'seed-tester',
          alias: 'Iva QA',
          companySim: {
            enabled: true,
            manifestPath,
            companyId: 'software-studio',
            employeeId: 'tester',
          },
        },
      },
    },
  },
} as any;

describe('company bootstrap', () => {
  test('loads software-studio template into workspace + employee bootstrap plan', () => {
    const plan = buildCompanyBootstrapPlan({
      manifestPath,
      resolveAccount: (accountId) => resolveDecentChatAccount(cfg, accountId),
    });

    expect(plan.companyId).toBe('software-studio');
    expect(plan.workspaceName).toBe('Studio HQ');
    expect(plan.channels).toEqual(['general', 'engineering', 'qa', 'leadership']);
    expect(plan.employees.map((e) => e.accountId)).toEqual(['team-manager', 'backend-dev', 'tester']);
    expect(plan.employees.find((e) => e.employeeId === 'backend-dev')?.alias).toBe('Rian Backend');
    expect(plan.employees.find((e) => e.employeeId === 'tester')?.title).toBe('QA Engineer');
  });

  test('fails when an employee account is not configured', () => {
    expect(() => buildCompanyBootstrapPlan({
      manifestPath,
      resolveAccount: (accountId) => resolveDecentChatAccount({ channels: { decentchat: { accounts: {} } } }, accountId),
    })).toThrow(/configured account/i);
  });
});
