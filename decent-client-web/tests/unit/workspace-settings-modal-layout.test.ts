import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/claw/Projects/decent-chat/decent-client-web';
const MODAL_PATH = join(ROOT, 'src/lib/components/modals/WorkspaceSettingsModal.svelte');
const CSS_PATH = join(ROOT, 'src/ui/styles/main.css');

describe('Workspace settings modal layout contract', () => {
  test('uses a dedicated constrained modal class with a scrollable body', () => {
    const modalSource = readFileSync(MODAL_PATH, 'utf8');
    const cssSource = readFileSync(CSS_PATH, 'utf8');

    expect(modalSource).toContain('class="modal workspace-settings-modal"');
    expect(modalSource).toContain('class="workspace-settings-form"');

    expect(cssSource).toContain('.workspace-settings-modal');
    expect(cssSource).toContain('overflow: hidden');
    expect(cssSource).toContain('.workspace-settings-form');
    expect(cssSource).toContain('overflow-y: auto');
  });
});
