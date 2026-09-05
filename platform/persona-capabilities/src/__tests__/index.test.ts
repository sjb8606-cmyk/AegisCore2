/**
 * @platform/persona-capabilities
 * Pure capability resolution + dispatch gating.
 * LIMITATION (dispatch): chatbot mode always throws and points callers at @platform/delight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/delight', () => ({
  resolvePersonaDir: () => '/fake/personas',
}));

const mockCreateAgentDefinition = vi.fn();
const mockInitiateRun = vi.fn();
vi.mock('@platform/ai-agents', () => ({
  createAgentDefinition: (...a: unknown[]) => mockCreateAgentDefinition(...a),
  initiateRun: (...a: unknown[]) => mockInitiateRun(...a),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
}));

const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    readdirSync: (...a: unknown[]) => mockReaddirSync(...a),
    readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  },
  readdirSync: (...a: unknown[]) => mockReaddirSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import {
  resolveCapabilities, canActAsBot, canActAsAgent, CapabilitiesSchema,
} from '../index';
import { dispatchPersona } from '../dispatch';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PERSONA = 'echo-guide';

describe('persona-capabilities / resolve', () => {
  it('applies defaults when capabilities omitted', () => {
    const caps = resolveCapabilities({});
    expect(caps.chatbot.enabled).toBe(true);
    expect(caps.bot.enabled).toBe(false);
    expect(caps.agent.enabled).toBe(false);
    expect(caps.bot.permissionScope).toEqual(['read:filesystem']);
  });

  it('parses explicit bot/agent flags', () => {
    const caps = resolveCapabilities({
      capabilities: {
        bot: { enabled: true, triggerConditions: ['cron'], permissionScope: ['read:db'] },
        agent: { enabled: true, permissionScope: ['write:tickets'] },
      },
    });
    expect(canActAsBot(caps)).toBe(true);
    expect(canActAsAgent(caps)).toBe(true);
    expect(caps.bot.triggerConditions).toEqual(['cron']);
    expect(caps.agent.permissionScope).toEqual(['write:tickets']);
  });

  it('canActAsBot/Agent return false when disabled', () => {
    const caps = CapabilitiesSchema.parse({});
    expect(canActAsBot(caps)).toBe(false);
    expect(canActAsAgent(caps)).toBe(false);
  });
});

describe('persona-capabilities / dispatchPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddirSync.mockReturnValue([
      { name: `${PERSONA}.json`, isDirectory: () => false },
    ]);
  });

  it('NOT_FOUND when persona file missing', async () => {
    mockReaddirSync.mockReturnValue([]);
    await expect(dispatchPersona(TENANT, PERSONA, 'bot', {}))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(/Persona not found/i) });
  });

  it('FORBIDDEN when bot mode requested but bot.enabled=false', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      name: 'Echo', capabilities: { bot: { enabled: false } },
    }));
    await expect(dispatchPersona(TENANT, PERSONA, 'bot', {}))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/does not have bot mode/i) });
  });

  it('bot mode success returns acknowledged payload with scope', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      name: 'Echo',
      capabilities: {
        bot: { enabled: true, triggerConditions: ['manual'], permissionScope: ['read:filesystem'] },
      },
    }));
    const result = await dispatchPersona(TENANT, PERSONA, 'bot', {});
    expect(result).toEqual({
      mode: 'bot',
      personaId: PERSONA,
      permissionScope: ['read:filesystem'],
      triggerConditions: ['manual'],
      status: 'bot_dispatch_acknowledged',
    });
  });

  it('FORBIDDEN when agent mode requested but agent.enabled=false', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      name: 'Echo', capabilities: { agent: { enabled: false } },
    }));
    await expect(dispatchPersona(TENANT, PERSONA, 'agent', { input: 'hi' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('agent mode creates definition + initiates run', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      name: 'Echo', worldview: 'Be helpful',
      capabilities: { agent: { enabled: true, permissionScope: ['write:tickets'] } },
    }));
    mockCreateAgentDefinition.mockResolvedValue({ id: 'def-1', name: 'Echo' });
    mockInitiateRun.mockResolvedValue({ id: 'run-1', status: 'queued' });

    const result = await dispatchPersona(TENANT, PERSONA, 'agent', {
      input: 'do the thing', userId: '22222222-2222-2222-2222-222222222222',
    });
    expect(result.mode).toBe('agent');
    expect(result.definition).toEqual({ id: 'def-1', name: 'Echo' });
    expect(result.run).toEqual({ id: 'run-1', status: 'queued' });
    expect(mockCreateAgentDefinition).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      name: 'Echo', persona_id: PERSONA, system_prompt: 'Be helpful',
    }));
    expect(mockInitiateRun).toHaveBeenCalledWith(
      TENANT, 'def-1', 'do the thing', '22222222-2222-2222-2222-222222222222',
    );
  });

  it('chatbot mode always BAD_REQUEST (LIMITATION – owned by delight)', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Echo', capabilities: {} }));
    await expect(dispatchPersona(TENANT, PERSONA, 'chatbot', { message: 'hi' }))
      .rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringMatching(/Use @platform\/delight processChat/i),
      });
  });
});
