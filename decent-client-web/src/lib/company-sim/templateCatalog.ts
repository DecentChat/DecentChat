import type {
  CompanyTemplateDefinition,
  CompanyTemplateInstallPreview,
  CompanyTemplateRoleAvatarStyle,
  CompanyTemplateRoleDefinition,
  CompanyTemplateRoleStatKey,
  CompanyTemplateRoleStats,
} from '../../ui/types';

const COMPANY_TEMPLATE_STAT_KEYS: CompanyTemplateRoleStatKey[] = ['planning', 'execution', 'quality', 'adaptability'];
const AVATAR_STYLES: CompanyTemplateRoleAvatarStyle[] = [
  'helm',
  'visor',
  'circuit',
  'glyph',
  'sentinel',
  'oracle',
  'wisp',
  'vanguard',
];

const AVATAR_STYLE_FAMILIES: Record<CompanyTemplateRoleAvatarStyle, CompanyTemplateRoleAvatarStyle[]> = {
  helm: ['helm', 'vanguard', 'sentinel'],
  visor: ['visor', 'oracle', 'wisp'],
  circuit: ['circuit', 'sentinel', 'vanguard'],
  glyph: ['glyph', 'oracle', 'wisp'],
  sentinel: ['sentinel', 'vanguard', 'circuit'],
  oracle: ['oracle', 'glyph', 'visor'],
  wisp: ['wisp', 'oracle', 'glyph'],
  vanguard: ['vanguard', 'helm', 'sentinel'],
};

const DEFAULT_ROLE_STATS: CompanyTemplateRoleStats = {
  planning: 54,
  execution: 58,
  quality: 55,
  adaptability: 53,
};

const softwareStudioRoles: CompanyTemplateRoleDefinition[] = [
  {
    id: 'manager',
    title: 'Team Manager',
    teamId: 'engineering',
    defaultAlias: 'Mira PM',
    aliasQuestionId: 'managerAlias',
    profile: {
      archetype: 'Ops Strategist',
      bioLine: 'Coordinates {{company}} priorities and keeps shipping rhythm steady.',
      traitPool: ['Calm under pressure', 'Sprint planner', 'Dependency wrangler', 'Sharp communicator', 'Risk radar'],
      statPreset: {
        planning: 86,
        execution: 64,
        quality: 63,
        adaptability: 71,
      },
      avatar: {
        style: 'helm',
        seed: 'manager-core',
        accent: '#f3b66f',
      },
      channelAffinity: 'leadership',
    },
  },
  {
    id: 'backend',
    title: 'Backend Engineer',
    teamId: 'engineering',
    defaultAlias: 'Devon API',
    aliasQuestionId: 'backendAlias',
    managerRoleId: 'manager',
    profile: {
      archetype: 'Systems Builder',
      bioLine: 'Owns reliability and throughput for {{company}} service backbone.',
      traitPool: ['Data model zealot', 'Latency hunter', 'API craftsperson', 'Observability-first', 'Pragmatic refactorer'],
      statPreset: {
        planning: 61,
        execution: 83,
        quality: 74,
        adaptability: 57,
      },
      avatar: {
        style: 'circuit',
        seed: 'backend-core',
        accent: '#66d4c8',
      },
      channelAffinity: 'engineering',
    },
  },
  {
    id: 'qa',
    title: 'QA Specialist',
    teamId: 'qa',
    defaultAlias: 'Iva QA',
    aliasQuestionId: 'qaAlias',
    managerRoleId: 'manager',
    profile: {
      archetype: 'Signal Guardian',
      bioLine: 'Protects release confidence and hunts regressions before users do.',
      traitPool: ['Scenario mapper', 'Edge-case predator', 'Bug forensic mindset', 'Clarity reporter', 'Automation discipline'],
      statPreset: {
        planning: 67,
        execution: 69,
        quality: 88,
        adaptability: 62,
      },
      avatar: {
        style: 'visor',
        seed: 'qa-core',
        accent: '#9a8dff',
      },
      channelAffinity: 'qa',
    },
  },
];

export const SOFTWARE_STUDIO_TEMPLATE: CompanyTemplateDefinition = {
  id: 'software-studio',
  label: 'Software Studio',
  description: 'A focused product delivery pod with manager, backend engineer, and QA specialist.',
  icon: '🧪',
  channels: ['general', 'engineering', 'qa', 'leadership'],
  roles: softwareStudioRoles,
  questions: [
    {
      id: 'companyName',
      label: 'Company name',
      required: true,
      placeholder: 'Acme Platform',
      defaultValue: 'Acme Platform',
      description: 'Displayed in installer summaries and generated company metadata.',
    },
    {
      id: 'managerAlias',
      label: 'Manager alias',
      required: true,
      placeholder: 'Mira PM',
      defaultValue: 'Mira PM',
    },
    {
      id: 'backendAlias',
      label: 'Backend alias',
      required: true,
      placeholder: 'Devon API',
      defaultValue: 'Devon API',
    },
    {
      id: 'qaAlias',
      label: 'QA alias',
      required: true,
      placeholder: 'Iva QA',
      defaultValue: 'Iva QA',
    },
  ],
};

const COMPANY_TEMPLATE_CATALOG: CompanyTemplateDefinition[] = [SOFTWARE_STUDIO_TEMPLATE];

function cloneTemplate(template: CompanyTemplateDefinition): CompanyTemplateDefinition {
  return {
    ...template,
    roles: template.roles.map((role) => ({
      ...role,
      profile: role.profile
        ? {
          ...role.profile,
          traitPool: [...(role.profile.traitPool ?? [])],
          statPreset: role.profile.statPreset ? { ...role.profile.statPreset } : undefined,
          avatar: role.profile.avatar ? { ...role.profile.avatar } : undefined,
        }
        : undefined,
    })),
    channels: [...template.channels],
    questions: template.questions.map((question) => ({ ...question })),
  };
}

export function listLocalCompanyTemplates(): CompanyTemplateDefinition[] {
  return COMPANY_TEMPLATE_CATALOG.map((template) => cloneTemplate(template));
}

export function getLocalCompanyTemplate(templateId: string): CompanyTemplateDefinition | null {
  const found = COMPANY_TEMPLATE_CATALOG.find((template) => template.id === templateId);
  if (!found) return null;
  return cloneTemplate(found);
}

function readAnswer(answers: Record<string, string>, questionId: string, fallback = ''): string {
  const raw = answers[questionId];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampStat(value: number): number {
  return Math.max(24, Math.min(98, Math.round(value)));
}

function tokenReplace(input: string, tokens: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key: string) => tokens[key] ?? '');
}

function deriveFallbackAccent(seed: string): string {
  const hue = hashString(`${seed}:accent`) % 360;
  const sat = 58 + (hashString(`${seed}:sat`) % 18);
  const light = 54 + (hashString(`${seed}:light`) % 10);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function deriveAvatarStyle(seed: string, anchorStyle?: CompanyTemplateRoleAvatarStyle): CompanyTemplateRoleAvatarStyle {
  const pool = anchorStyle
    ? (AVATAR_STYLE_FAMILIES[anchorStyle] ?? AVATAR_STYLES)
    : AVATAR_STYLES;
  return pool[hashString(`${seed}:${anchorStyle ?? 'any'}:style`) % pool.length] ?? anchorStyle ?? 'helm';
}

function normalizeSeed(seed: string, fallback: string): string {
  const cleaned = seed.trim();
  if (cleaned) return cleaned;
  return `seed-${hashString(fallback).toString(36)}`;
}

function pickTraits(pool: string[], seed: string): string[] {
  const unique = [...new Set(pool.map((trait) => trait.trim()).filter(Boolean))];
  if (unique.length <= 3) return unique;

  return unique
    .map((trait) => ({ trait, score: hashString(`${seed}:${trait}`) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((entry) => entry.trait);
}

function makeAvatarDataUrl(opts: {
  seed: string;
  style: CompanyTemplateRoleAvatarStyle;
  accent: string;
  alias: string;
}): string {
  const { seed, style, accent, alias } = opts;
  const hash = hashString(`${seed}:${style}`);
  const rng = seededRandom(hash);
  const variant = hash % 3;

  const bgHue = hash % 360;
  const bg2 = (bgHue + 42 + (hash % 34)) % 360;
  const detailHue = (bgHue + 186 + (hash % 32)) % 360;
  const frameRadius = 17 + Math.floor(rng() * 8);
  const eyeY = 54 + Math.floor(rng() * 14);
  const eyeSpread = 17 + Math.floor(rng() * 10);
  const eyeSize = 2.5 + rng() * 2.4;
  const haloSize = 26 + Math.floor(rng() * 18);

  const initials = alias
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  const symbol = initials || alias.trim().charAt(0).toUpperCase() || '?';
  const symbolFont = symbol.length > 1 ? 24 : 30;
  const escapedAlias = escapeXml(alias || 'Crew member');

  const faceShape = (() => {
    switch (style) {
      case 'visor': {
        const visorHeight = 14 + (variant * 3);
        return `<rect x="24" y="18" width="80" height="84" rx="28" fill="#121a2b" stroke="${accent}" stroke-width="3" />
          <rect x="34" y="42" width="60" height="${visorHeight}" rx="8" fill="${accent}" opacity="0.9" />
          <path d="M38 72h52" stroke="${accent}" opacity="0.55" stroke-width="3" stroke-linecap="round" />`;
      }
      case 'circuit': {
        return `<rect x="22" y="20" width="84" height="80" rx="20" fill="#121929" stroke="${accent}" stroke-width="3" />
          <path d="M34 48h16m10 0h18m-30 14h30m-24 14h18" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.75" />
          <circle cx="48" cy="48" r="4" fill="${accent}" /><circle cx="82" cy="48" r="4" fill="${accent}" />
          <path d="M34 76h10m40 0h10" stroke="hsl(${detailHue} 74% 76%)" opacity="0.65" stroke-width="2" stroke-linecap="round" />`;
      }
      case 'glyph': {
        return `<path d="M64 16 106 42v44L64 112 22 86V42Z" fill="#141c30" stroke="${accent}" stroke-width="3" />
          <circle cx="64" cy="58" r="${20 + variant * 3}" fill="${accent}" opacity="0.18" />
          <path d="M64 34v48M40 58h48" stroke="hsl(${detailHue} 78% 78%)" opacity="0.6" stroke-width="${1.8 + variant * 0.5}" stroke-linecap="round" />`;
      }
      case 'sentinel': {
        return `<path d="M64 14 104 34v28c0 22-17 40-40 48-23-8-40-26-40-48V34Z" fill="#151f34" stroke="${accent}" stroke-width="3" />
          <rect x="42" y="44" width="44" height="15" rx="7" fill="${accent}" opacity="0.8" />
          <path d="M50 76h28" stroke="hsl(${detailHue} 72% 80%)" stroke-width="3" stroke-linecap="round" opacity="0.85" />`;
      }
      case 'oracle': {
        const ring = 16 + variant * 5;
        return `<circle cx="64" cy="60" r="42" fill="#141b2f" stroke="${accent}" stroke-width="3" />
          <circle cx="64" cy="60" r="${ring}" fill="none" stroke="${accent}" stroke-width="2.2" opacity="0.78" />
          <path d="M34 52c10-10 50-10 60 0" stroke="hsl(${detailHue} 76% 78%)" stroke-width="2.6" stroke-linecap="round" opacity="0.82" />
          <path d="M38 74c10 8 42 8 52 0" stroke="${accent}" stroke-width="2" stroke-linecap="round" opacity="0.54" />`;
      }
      case 'wisp': {
        return `<circle cx="64" cy="62" r="42" fill="#131a2d" stroke="${accent}" stroke-width="2.6" />
          <path d="M34 72c12-16 14-28 30-30 16 2 18 14 30 30" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.9" />
          <path d="M40 46c8-7 40-7 48 0" stroke="hsl(${detailHue} 72% 79%)" stroke-width="2.4" stroke-linecap="round" opacity="0.72" />`;
      }
      case 'vanguard': {
        return `<path d="M20 36 44 20h40l24 16v50L90 104H38L20 86Z" fill="#121a2e" stroke="${accent}" stroke-width="3" />
          <path d="M36 46h56v16H36z" fill="${accent}" opacity="0.22" />
          <path d="M44 70h40" stroke="hsl(${detailHue} 74% 80%)" stroke-width="3" stroke-linecap="round" opacity="0.8" />`;
      }
      default: {
        return `<circle cx="64" cy="62" r="43" fill="#121a2b" stroke="${accent}" stroke-width="3" />
          <rect x="28" y="12" width="72" height="20" rx="8" fill="${accent}" opacity="0.22" />`;
      }
    }
  })();

  const cornerSigil = (() => {
    if (variant === 0) {
      return '<path d="M96 18h14v14" stroke="rgba(255,255,255,0.36)" stroke-width="1.6" stroke-linecap="round" />';
    }
    if (variant === 1) {
      return '<circle cx="103" cy="25" r="5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />';
    }
    return '<rect x="95" y="17" width="16" height="16" rx="4" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />';
  })();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${escapedAlias} avatar">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${bgHue} 46% 19%)" />
        <stop offset="100%" stop-color="hsl(${bg2} 38% 10%)" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="44%" r="70%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.34" />
        <stop offset="100%" stop-color="${accent}" stop-opacity="0" />
      </radialGradient>
      <pattern id="scan" width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 0h6" stroke="rgba(255,255,255,0.075)" stroke-width="1" />
      </pattern>
      <pattern id="grid" width="14" height="14" patternUnits="userSpaceOnUse">
        <path d="M0 7h14M7 0v14" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="128" height="128" rx="${frameRadius}" fill="url(#bg)" />
    <rect width="128" height="128" rx="${frameRadius}" fill="url(#scan)" />
    <rect width="128" height="128" rx="${frameRadius}" fill="url(#grid)" opacity="${0.52 + rng() * 0.22}" />
    <circle cx="64" cy="58" r="${haloSize}" fill="url(#glow)" />
    ${faceShape}
    <circle cx="${64 - eyeSpread}" cy="${eyeY}" r="${eyeSize}" fill="hsl(${detailHue} 74% 80%)" />
    <circle cx="${64 + eyeSpread}" cy="${eyeY}" r="${eyeSize}" fill="hsl(${detailHue} 74% 80%)" />
    <text x="64" y="96" text-anchor="middle" font-size="${symbolFont}" fill="${accent}" opacity="0.9" font-family="ui-sans-serif, system-ui, -apple-system">${escapeXml(symbol)}</text>
    ${cornerSigil}
    <rect x="2" y="2" width="124" height="124" rx="${Math.max(12, frameRadius - 2)}" fill="none" stroke="rgba(255,255,255,0.14)" />
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function roleTraitFallback(role: CompanyTemplateRoleDefinition): string[] {
  const titleWord = role.title.split(/\s+/).filter(Boolean)[0] ?? 'Specialist';
  return [
    `${titleWord} discipline`,
    'Reliable handoff',
    'Async communicator',
  ];
}

function buildRoleStats(opts: {
  role: CompanyTemplateRoleDefinition;
  template: CompanyTemplateDefinition;
  answers: Record<string, string>;
  alias: string;
  companyName: string;
}): CompanyTemplateRoleStats {
  const { role, template, answers, alias, companyName } = opts;
  const rng = seededRandom(hashString(`${template.id}:${role.id}:${companyName}:${alias}`));

  const stats = {} as CompanyTemplateRoleStats;

  for (const key of COMPANY_TEMPLATE_STAT_KEYS) {
    const preset = role.profile?.statPreset?.[key] ?? DEFAULT_ROLE_STATS[key];
    const answerPulse = (hashString(`${key}:${answers.companyName ?? ''}:${role.id}`) % 9) - 4;
    const jitter = Math.round((rng() - 0.5) * 12);
    stats[key] = clampStat(preset + answerPulse + jitter);
  }

  return stats;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function resolveRoleAlias(
  role: CompanyTemplateRoleDefinition,
  template: CompanyTemplateDefinition,
  answers: Record<string, string>,
): string {
  if (role.aliasQuestionId) {
    return readAnswer(
      answers,
      role.aliasQuestionId,
      template.questions.find((question) => question.id === role.aliasQuestionId)?.defaultValue ?? role.defaultAlias,
    );
  }

  return readAnswer(answers, `alias:${role.id}`, role.defaultAlias);
}

export function buildTemplateDefaultAnswers(template: CompanyTemplateDefinition): Record<string, string> {
  const defaults: Record<string, string> = {};

  for (const question of template.questions) {
    defaults[question.id] = question.defaultValue ?? '';
  }

  for (const role of template.roles) {
    if (!role.aliasQuestionId) {
      defaults[`alias:${role.id}`] = role.defaultAlias;
    }

    if (typeof role.profile?.avatar?.seed === 'string' && role.profile.avatar.seed.trim()) {
      defaults[`avatarSeed:${role.id}`] = role.profile.avatar.seed.trim();
    }
  }

  return defaults;
}

export function deriveRerolledAvatarSeed(currentSeed: string, salt = ''): string {
  const normalized = normalizeSeed(currentSeed, salt || 'avatar');
  return `seed-${hashString(`${normalized}:${salt}:reroll`).toString(36)}`;
}

export function buildCompanyTemplatePreview(
  template: CompanyTemplateDefinition,
  answers: Record<string, string>,
  options?: { workspaceName?: string | null },
): CompanyTemplateInstallPreview {
  const companyName = readAnswer(
    answers,
    'companyName',
    template.questions.find((question) => question.id === 'companyName')?.defaultValue ?? 'Company',
  );

  const workspaceName = (() => {
    const explicitWorkspaceName = typeof options?.workspaceName === 'string' ? options.workspaceName.trim() : '';
    if (explicitWorkspaceName) return explicitWorkspaceName;

    return readAnswer(
      answers,
      'workspaceName',
      'Workspace',
    );
  })();

  const members = template.roles.map((role) => {
    const alias = resolveRoleAlias(role, template, answers);

    const peerIdBase = slugify(`${companyName}-${role.id}`);

    const avatarSeed = normalizeSeed(
      readAnswer(
        answers,
        `avatarSeed:${role.id}`,
        role.profile?.avatar?.seed ?? `${template.id}:${companyName}:${role.id}`,
      ),
      `${template.id}:${role.id}:${companyName}`,
    );

    const defaultRoleSeed = role.profile?.avatar?.seed?.trim();
    const defaultRoleSeedNormalized = defaultRoleSeed
      ? normalizeSeed(defaultRoleSeed, `${template.id}:${role.id}:${companyName}`)
      : null;
    const baseStyle = role.profile?.avatar?.style;
    const avatarStyle = baseStyle
      ? ((defaultRoleSeedNormalized && avatarSeed === defaultRoleSeedNormalized)
        ? baseStyle
        : deriveAvatarStyle(avatarSeed, baseStyle))
      : deriveAvatarStyle(avatarSeed);
    const avatarAccent = role.profile?.avatar?.accent?.trim() || deriveFallbackAccent(avatarSeed);

    const traits = pickTraits(role.profile?.traitPool ?? roleTraitFallback(role), `${avatarSeed}:${alias}:${companyName}`);

    const channelAffinity = role.profile?.channelAffinity?.trim() || undefined;

    const bioTemplate = role.profile?.bioLine?.trim() || `${role.title} assigned to {{company}} operations.`;
    const bioLine = tokenReplace(bioTemplate, {
      alias,
      company: companyName,
      workspace: workspaceName,
      channel: channelAffinity ?? 'general',
    });

    return {
      roleId: role.id,
      roleTitle: role.title,
      teamId: role.teamId,
      alias,
      peerId: peerIdBase || role.id,
      managerRoleId: role.managerRoleId,
      archetype: role.profile?.archetype ?? 'Specialist',
      bioLine,
      traits,
      stats: buildRoleStats({
        role,
        template,
        answers,
        alias,
        companyName,
      }),
      channelAffinity,
      avatar: {
        style: avatarStyle,
        seed: avatarSeed,
        accent: avatarAccent,
        dataUrl: makeAvatarDataUrl({
          seed: avatarSeed,
          style: avatarStyle,
          accent: avatarAccent,
          alias,
        }),
      },
    };
  });

  return {
    templateId: template.id,
    templateLabel: template.label,
    companyName,
    workspaceName,
    channelNames: [...template.channels],
    members,
  };
}
