import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/ai-gateway', () => ({
  generateText: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { buildRiskRegister, runRedTeamPass, finalizeRiskRegister, buildHiringPlan } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { generateText } from '@platform/ai-gateway';
import { loadConfig } from '@platform/utils';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const IDEA_ID = '33333333-3333-3333-3333-333333333333';
const REGISTER_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({
    enabled: true,
    redTeamMode: true,
    limits: { risksPerRegister: 30, redTeamPassesPerRun: 1 },
  });
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
    return Promise.resolve([{ id: 'row-1' }]);
  });
});

describe('risk-register.buildRiskRegister', () => {
  it('stores generated risks with confidence tags', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: JSON.stringify([
        {
          description: 'No local wild-strawberry supply chain exists at scale.',
          category: 'operational',
          probability: 'high',
          impact: 'high',
          mitigation: 'Pilot with wild-harvest partners before committing capital.',
          validationRequired: 'Confirm harvest volume with 3 local partners.',
          confidenceTag: 'assumption',
        },
      ]),
      finishReason: 'stop',
    });

    const result = await buildRiskRegister(TENANT_ID, ACTOR_ID, {
      ideaId: IDEA_ID,
      unverifiedClaims: ['Demand will grow 20% next year.'],
      financialSummary: 'Break-even month 8.',
      businessModel: 'Wild strawberry preserve subscription box.',
    });

    expect(result.riskCount).toBe(1);
    expect(result.risks[0].confidenceTag).toBe('assumption');
  });

  it('throws on malformed model output instead of storing garbage', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: 'not valid json',
      finishReason: 'stop',
    });
    await expect(
      buildRiskRegister(TENANT_ID, ACTOR_ID, {
        ideaId: IDEA_ID,
        unverifiedClaims: [],
        financialSummary: '',
        businessModel: '',
      }),
    ).rejects.toThrow();
  });
});

describe('risk-register.runRedTeamPass', () => {
  it('records attack/verdict pairs for each challenged assumption', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: JSON.stringify([
        {
          challengedAssumption: 'Demand will grow 20% next year.',
          attack: 'No evidence beyond a single unverified claim.',
          verdict: 'weakens',
        },
      ]),
      finishReason: 'stop',
    });
    const result = await runRedTeamPass(TENANT_ID, ACTOR_ID, {
      registerId: REGISTER_ID,
      topRisks: [],
      assumptions: ['Demand will grow 20% next year.'],
    });
    expect(result.passes[0].verdict).toBe('weakens');
  });
});

describe('risk-register.finalizeRiskRegister', () => {
  it('refuses to finalize when redTeamMode is on and no pass has run', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('red_team_passes')) return Promise.resolve([{ count: '0' }]);
      return Promise.resolve([{ id: 'row-1' }]);
    });
    await expect(finalizeRiskRegister(TENANT_ID, ACTOR_ID, { registerId: REGISTER_ID })).rejects.toThrow();
  });

  it('finalizes once at least one red team pass exists', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('red_team_passes')) return Promise.resolve([{ count: '1' }]);
      return Promise.resolve([{ id: 'row-1' }]);
    });
    const result = await finalizeRiskRegister(TENANT_ID, ACTOR_ID, { registerId: REGISTER_ID });
    expect(result.status).toBe('finalized');
  });

  it('allows finalize with zero passes when redTeamMode is explicitly off', async () => {
    (loadConfig as any).mockReturnValue({
      enabled: true,
      redTeamMode: false,
      limits: { risksPerRegister: 30, redTeamPassesPerRun: 1 },
    });
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('red_team_passes')) return Promise.resolve([{ count: '0' }]);
      return Promise.resolve([{ id: 'row-1' }]);
    });
    const result = await finalizeRiskRegister(TENANT_ID, ACTOR_ID, { registerId: REGISTER_ID });
    expect(result.status).toBe('finalized');
  });
});

describe('risk-register.buildHiringPlan', () => {
  it('stores staged hiring roles keyed to break-even timing', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: JSON.stringify([
        {
          stageNumber: 1,
          roleTitle: 'Production Lead',
          skillsRequired: 'Food handling, small-batch preserving',
          triggerCondition: 'Monthly revenue exceeds $8,000',
          approxHeadcount: 1,
        },
      ]),
      finishReason: 'stop',
    });
    const result = await buildHiringPlan(TENANT_ID, ACTOR_ID, {
      ideaId: IDEA_ID,
      breakEvenMonth: 8,
      businessModel: 'Wild strawberry preserve subscription box.',
    });
    expect(result.stages.length).toBe(1);
    expect(result.stages[0].roleTitle).toBe('Production Lead');
  });
});
