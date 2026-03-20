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

const SUMMARY_TRIGGER_TAGS = new Set(['blocked', 'handoff', 'done']);

function extractDelimitedFieldToken(text: string, expectedTag: string, fieldName: string): string | null {
  if (extractCommunicationTag(text) !== expectedTag) return null;

  const fieldMatch = text.match(new RegExp(`\\b${fieldName}\\s*[:=]\\s*([^;,.\\n\\r]+)`, 'i'));
  if (!fieldMatch) return null;

  const value = normalize(fieldMatch[1] ?? '');
  return value || null;
}

export function extractCommunicationTag(text: string): string | null {
  const match = text.match(/^\s*\[([A-Za-z-]+)/);
  if (!match) return null;
  const tag = normalize(match[1] ?? '');
  return tag || null;
}

export function hasSummaryTriggerTag(text: string): boolean {
  const tag = extractCommunicationTag(text);
  return Boolean(tag && SUMMARY_TRIGGER_TAGS.has(tag));
}

export function extractTaskOwnerToken(text: string): string | null {
  return extractDelimitedFieldToken(text, 'task', 'owner');
}

export function isTaskOwnedByEmployee(text: string, employee: CompanyEmployeeConfig): boolean {
  const owner = extractTaskOwnerToken(text);
  if (!owner) return false;

  const known = buildEmployeeMentionTokens(employee);
  return known.has(owner);
}

export function hasExplicitTaskOwner(text: string): boolean {
  return extractTaskOwnerToken(text) !== null;
}

export function extractHandoffTargetToken(text: string): string | null {
  return extractDelimitedFieldToken(text, 'handoff', 'target');
}

export function isHandoffTargetedToEmployee(text: string, employee: CompanyEmployeeConfig): boolean {
  const target = extractHandoffTargetToken(text);
  if (!target) return false;

  const known = buildEmployeeMentionTokens(employee);
  return known.has(target);
}

export function hasExplicitHandoffTarget(text: string): boolean {
  return extractHandoffTargetToken(text) !== null;
}
