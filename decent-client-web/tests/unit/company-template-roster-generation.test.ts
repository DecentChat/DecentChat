import { describe, expect, test } from 'bun:test';

import {
  buildCompanyTemplatePreview,
  buildTemplateDefaultAnswers,
  deriveRerolledAvatarSeed,
  getLocalCompanyTemplate,
} from '../../src/lib/company-sim/templateCatalog';

describe('company template roster generation', () => {
  test('builds deterministic profiles from template + answers', () => {
    const template = getLocalCompanyTemplate('software-studio');
    if (!template) throw new Error('software-studio template missing');

    const answers = {
      ...buildTemplateDefaultAnswers(template),
      companyName: 'Acme Platform',
      managerAlias: 'Mira PM',
      backendAlias: 'Devon API',
      qaAlias: 'Iva QA',
    };

    const first = buildCompanyTemplatePreview(template, answers, { workspaceName: 'Template QA' });
    const second = buildCompanyTemplatePreview(template, answers, { workspaceName: 'Template QA' });

    expect(first.members).toHaveLength(3);
    expect(first.members).toEqual(second.members);

    for (const member of first.members) {
      expect(member.avatar?.dataUrl.startsWith('data:image/svg+xml;utf8,')).toBeTrue();
      expect(member.traits?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(member.stats?.planning ?? 0).toBeGreaterThan(20);
    }
  });

  test('uses rerolled seed to produce a different avatar deterministically', () => {
    const template = getLocalCompanyTemplate('software-studio');
    if (!template) throw new Error('software-studio template missing');

    const answers = {
      ...buildTemplateDefaultAnswers(template),
      companyName: 'Acme Platform',
    };

    const initialPreview = buildCompanyTemplatePreview(template, answers, { workspaceName: 'Template QA' });
    const manager = initialPreview.members.find((member) => member.roleId === 'manager');
    if (!manager?.avatar) throw new Error('manager avatar missing');

    const rerolledSeed = deriveRerolledAvatarSeed(manager.avatar.seed, 'software-studio:manager:Acme Platform');
    const rerolledPreview = buildCompanyTemplatePreview(template, {
      ...answers,
      'avatarSeed:manager': rerolledSeed,
    }, { workspaceName: 'Template QA' });
    const rerolledManager = rerolledPreview.members.find((member) => member.roleId === 'manager');
    if (!rerolledManager?.avatar) throw new Error('rerolled manager avatar missing');

    expect(rerolledManager.avatar.seed).toBe(rerolledSeed);
    expect(rerolledManager.avatar.dataUrl).not.toBe(manager.avatar.dataUrl);

    const sameRerolledAgain = buildCompanyTemplatePreview(template, {
      ...answers,
      'avatarSeed:manager': rerolledSeed,
    }, { workspaceName: 'Template QA' });

    expect(sameRerolledAgain.members.find((member) => member.roleId === 'manager')?.avatar?.dataUrl)
      .toBe(rerolledManager.avatar.dataUrl);
  });

  test('rerolls can shift portrait style families while staying deterministic', () => {
    const template = getLocalCompanyTemplate('software-studio');
    if (!template) throw new Error('software-studio template missing');

    const answers = {
      ...buildTemplateDefaultAnswers(template),
      companyName: 'Acme Platform',
    };

    const initial = buildCompanyTemplatePreview(template, answers, { workspaceName: 'Template QA' });
    const manager = initial.members.find((member) => member.roleId === 'manager');
    if (!manager?.avatar) throw new Error('manager avatar missing');

    const rerolledSeed = deriveRerolledAvatarSeed(manager.avatar.seed, 'software-studio:manager:Acme Platform');
    const rerolled = buildCompanyTemplatePreview(template, {
      ...answers,
      'avatarSeed:manager': rerolledSeed,
    }, { workspaceName: 'Template QA' });

    const rerolledManager = rerolled.members.find((member) => member.roleId === 'manager');
    if (!rerolledManager?.avatar) throw new Error('rerolled manager avatar missing');

    expect(['helm', 'vanguard', 'sentinel']).toContain(rerolledManager.avatar.style);

    const rerolledAgain = buildCompanyTemplatePreview(template, {
      ...answers,
      'avatarSeed:manager': rerolledSeed,
    }, { workspaceName: 'Template QA' });

    expect(rerolledAgain.members.find((member) => member.roleId === 'manager')?.avatar?.style)
      .toBe(rerolledManager.avatar.style);
  });
});
