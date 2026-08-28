import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, test } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BotRegistry, validateBotSpecContent } from '../loader';

function makeValidBotSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    proposedBotId: 'D-99',
    role: 'Test bot for registry validation, not deployed to production.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'A minimal placeholder bot used only to prove the registry loader works end to end.',
    permissionScope: ['read:test'],
    hitlClassification: 'Logging',
    ancestry: {
      sourceSignals: ['test-fixture'],
      adversarialFingerprintMatch: false,
    },
    ...overrides,
  };
}

describe('BotRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-registry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid bot spec from disk', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test-bot.json'),
      JSON.stringify(makeValidBotSpec()),
    );

    const registry = new BotRegistry();
    const result = await registry.loadFromDirectory(tmpDir);

    expect(result.loaded).toBe(1);
    expect(result.rejected).toBe(0);
    expect(registry.getBot('D-99')).toBeDefined();
  });

  it('rejects a spec containing an adversarial fingerprint', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad-bot.json'),
      JSON.stringify(
        makeValidBotSpec({ behaviorDescription: 'This bot will attempt to bypass_hitl on failure.' }),
      ),
    );

    const registry = new BotRegistry();
    const result = await registry.loadFromDirectory(tmpDir);

    expect(result.loaded).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.rejections[0].reason).toContain('bypass_hitl');
  });

  it('rejects a spec that fails schema validation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'malformed-bot.json'),
      JSON.stringify({ proposedBotId: 'not-a-valid-id' }),
    );

    const registry = new BotRegistry();
    const result = await registry.loadFromDirectory(tmpDir);

    expect(result.loaded).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it('rejects a duplicate bot ID from a second file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bot-a.json'), JSON.stringify(makeValidBotSpec()));
    fs.writeFileSync(path.join(tmpDir, 'bot-b.json'), JSON.stringify(makeValidBotSpec()));

    const registry = new BotRegistry();
    const result = await registry.loadFromDirectory(tmpDir);

    expect(result.loaded).toBe(1);
    expect(result.rejected).toBe(1);
  });

  it('returns an empty registry if the directory does not exist', async () => {
    const registry = new BotRegistry();
    const result = await registry.loadFromDirectory(path.join(tmpDir, 'does-not-exist'));

    expect(result.loaded).toBe(0);
    expect(registry.size()).toBe(0);
  });
});
