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
    accountId: team-manager
    alias: Mira PM
    teamId: engineering
    title: Team Manager
    channels: [general, engineering]
    participation:
      mode: summary-first
      respondWhenMentioned: true
  - id: backend-dev
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });



  test('parses bundled software-studio template', () => {
    const manifest = parseCompanyManifestFile(new URL('../../../company-sims/software-studio/company.yaml', import.meta.url).pathname);
    expect(manifest.id).toBe('software-studio');
    expect(manifest.employees.length).toBe(3);
    expect(getCompanyEmployeeById(manifest, 'tester')?.title).toBe('QA Engineer');
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
});
