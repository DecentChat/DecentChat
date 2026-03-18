import type { CompanyEmployeeConfig } from './types.ts';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function extractMentionTokens(text: string): string[] {
  const matches = text.match(/(^|\s)@[A-Za-z0-9_.\-]+/g) || [];
  return matches
    .map((token) => token.replace(/^\s*@/, '').trim().toLowerCase())
    .filter(Boolean);
}

export function buildEmployeeMentionTokens(employee: CompanyEmployeeConfig): Set<string> {
  const values = new Set<string>();
  const add = (raw?: string) => {
    if (!raw) return;
    const normalized = normalize(raw);
    if (normalized) values.add(normalized);
    for (const part of raw.split(/\s+/)) {
      const piece = normalize(part);
      if (piece) values.add(piece);
    }
  };

  add(employee.alias);
  add(employee.id);
  add(employee.accountId);
  add(employee.title);

  return values;
}

export function isEmployeeMentioned(text: string, employee: CompanyEmployeeConfig): boolean {
  const mentions = extractMentionTokens(text);
  if (mentions.length === 0) return false;
  const known = buildEmployeeMentionTokens(employee);
  return mentions.some((token) => known.has(token));
}

export function matchesParticipationTopic(text: string, topics?: string[]): boolean {
  if (!topics || topics.length === 0) return false;
  const haystack = normalize(text);
  return topics.some((topic) => haystack.includes(normalize(topic)));
}

export function isAssignedChannel(employee: CompanyEmployeeConfig, channelNameOrId?: string): boolean {
  if (!channelNameOrId) return false;
  const normalized = normalize(channelNameOrId);
  return employee.channels.some((channel) => normalize(channel) === normalized);
}
