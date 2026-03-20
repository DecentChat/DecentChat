import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('scripts/deploy.sh safety', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'deploy.sh'), 'utf8');

  test('does not use mirror --delete', () => {
    expect(script).not.toMatch(/mirror\s+[^\n]*--delete/);
  });

  test('uses sftp transport for decentchat deploy', () => {
    expect(script).toContain('sftp://$DEPLOY_HOST');
  });

  test('defaults to the known safe remote web root', () => {
    expect(script).toContain(': "${DEPLOY_REMOTE_PATH:=/decentchat.app/web/}"');
  });
});
