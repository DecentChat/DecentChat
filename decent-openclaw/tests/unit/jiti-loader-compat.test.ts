import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../..');
const decentChatNodePeerModulePath = path.join(repoRoot, 'src/peer/DecentChatNodePeer.ts');

function runNodeJitiProbe(entryPath: string) {
  const script = `
    const path = require('node:path');
    const repoRoot = ${JSON.stringify(repoRoot)};
    const pluginSdkPath = require.resolve('openclaw/plugin-sdk', { paths: [repoRoot] });
    const openClawRoot = path.resolve(path.dirname(pluginSdkPath), '..');
    const { createJiti } = require(require.resolve('jiti', { paths: [openClawRoot] }));
    const jiti = createJiti(path.join(repoRoot, '.jiti-loader-compat.cjs'), {
      interopDefault: true,
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.mtsx', '.ctsx', '.js', '.mjs', '.cjs', '.json'],
      alias: {
        'openclaw/plugin-sdk': pluginSdkPath,
        'openclaw/plugin-sdk/account-id': path.join(path.dirname(pluginSdkPath), 'account-id.js'),
      },
    });
    const mod = jiti(${JSON.stringify(entryPath)});
    const value = mod.DecentChatNodePeer ?? mod.decentChatNodePeerType;
    const valueType = typeof value === 'function' ? 'function' : value;
    if (valueType !== 'function') {
      throw new Error('unexpected export: ' + String(value));
    }
    console.log(valueType);
  `;

  return spawnSync('node', ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('OpenClaw Jiti compatibility', () => {
  test('loads DecentChatNodePeer through the same Jiti loader OpenClaw uses', () => {
    const result = runNodeJitiProbe(decentChatNodePeerModulePath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function');
  });

  test('loads a Jiti module that statically imports DecentChatNodePeer', () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'openclaw-jiti-loader-'));
    const fixturePath = path.join(fixtureDir, 'probe.ts');

    writeFileSync(
      fixturePath,
      `import { DecentChatNodePeer } from ${JSON.stringify(decentChatNodePeerModulePath)};\nexport const decentChatNodePeerType = typeof DecentChatNodePeer;\n`,
    );

    const result = runNodeJitiProbe(fixturePath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function');
  });
});
