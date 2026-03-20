import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getCompanyEmployeeById,
  getCompanyTeamById,
  parseCompanyManifestFile,
  parseCompanyManifestText,
} from '../../src/company-sim/manifest.ts';

describe('company-sim manifest', () => {
  test('parses valid manifest text and supports employee/team lookup', () => {
    const manifest = parseCompanyManifestText(`
id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels:
    - general
    - engineering
teams:
  - id: engineering
    name: Engineering
    managerEmployeeId: team-manager
employees:
  - id: team-manager
    agentId: software-studio-team-manager
    accountId: team-manager
    alias: Mira PM
    teamId: engineering
    title: Team Manager
    channels: [general, engineering]
    participation:
      mode: summary-first
      respondWhenMentioned: true
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    managerEmployeeId: team-manager
    channels: [engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
`);

    expect(manifest.id).toBe('software-studio');
    expect(manifest.mode).toBe('company-sim');
    expect(manifest.workspace.channels).toEqual(['general', 'engineering']);
    expect(getCompanyTeamById(manifest, 'engineering')?.name).toBe('Engineering');
    expect(getCompanyEmployeeById(manifest, 'team-manager')?.title).toBe('Team Manager');
    expect(getCompanyEmployeeById(manifest, 'team-manager')?.agentId).toBe('software-studio-team-manager');
    expect(getCompanyEmployeeById(manifest, 'missing')).toBeUndefined();
  });

  test('parses manifest file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-manifest-'));
    try {
      const filePath = join(dir, 'company.yaml');
      writeFileSync(filePath, `
id: test-company
name: Test Company
mode: company-sim
workspace:
  name: Test HQ
  channels: [general]
teams:
  - id: ops
    name: Operations
employees:
  - id: lead
    agentId: lead-agent
    accountId: lead
    alias: Lea
    teamId: ops
    title: Lead
    channels: [general]
    participation:
      mode: summary-first
`);

      const manifest = parseCompanyManifestFile(filePath);
      expect(manifest.name).toBe('Test Company');
      expect(getCompanyEmployeeById(manifest, 'lead')?.alias).toBe('Lea');
      expect(getCompanyEmployeeById(manifest, 'lead')?.agentId).toBe('lead-agent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('parses bundled software-studio template', () => {
    const manifest = parseCompanyManifestFile(new URL('../../../company-sims/software-studio/company.yaml', import.meta.url).pathname);
    expect(manifest.id).toBe('software-studio');
    expect(manifest.employees.length).toBe(3);
    expect(getCompanyEmployeeById(manifest, 'tester')?.title).toBe('QA Engineer');
    expect(getCompanyEmployeeById(manifest, 'tester')?.agentId).toBe('software-studio-tester');
  });

  test('supports optional employee workspace and binding fields', () => {
    const manifest = parseCompanyManifestText(`
id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels: [engineering]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    workspaceDir: company-sims/software-studio/employees/backend-dev
    workspaceName: Backend Dev Workspace
    bindings:
      - channel: decentchat
        accountId: backend-dev
    channels: [engineering]
    participation:
      mode: specialist
`);

    const employee = getCompanyEmployeeById(manifest, 'backend-dev');
    expect(employee?.workspaceDir).toBe('company-sims/software-studio/employees/backend-dev');
    expect(employee?.workspaceName).toBe('Backend Dev Workspace');
    expect(employee?.bindings).toEqual([
      { channel: 'decentchat', accountId: 'backend-dev' },
    ]);
  });

  test('rejects employee entries that omit agentId', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/agentId/i);
  });

  test('rejects employee entries that omit accountId', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    agentId: software-studio-backend
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/accountId/i);
  });

  test('rejects duplicate employee agent ids separately from account ids', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: e1
    agentId: shared-agent
    accountId: account-one
    alias: One
    teamId: engineering
    title: Engineer
    channels: [general]
    participation:
      mode: specialist
  - id: e2
    agentId: shared-agent
    accountId: account-two
    alias: Two
    teamId: engineering
    title: Engineer
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/duplicate employee agent id: shared-agent/i);
  });

  test('rejects duplicate employee account ids separately from agent ids', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: e1
    agentId: agent-one
    accountId: shared-account
    alias: One
    teamId: engineering
    title: Engineer
    channels: [general]
    participation:
      mode: specialist
  - id: e2
    agentId: agent-two
    accountId: shared-account
    alias: Two
    teamId: engineering
    title: Engineer
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/duplicate employee account id: shared-account/i);
  });

  test('rejects employee team references that do not exist', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: missing-team
    title: Backend Engineer
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/unknown team/i);
  });

  test('rejects manager references that do not exist', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
    managerEmployeeId: missing-manager
employees:
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    managerEmployeeId: missing-manager
    channels: [general]
    participation:
      mode: specialist
`)).toThrow(/unknown manager/i);
  });

  test('rejects employee channel references that are not in workspace channels', () => {
    expect(() => parseCompanyManifestText(`
id: broken-company
name: Broken Company
mode: company-sim
workspace:
  name: Broken HQ
  channels: [general]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [engineering]
    participation:
      mode: specialist
`)).toThrow(/unknown workspace channel/i);
  });
});
