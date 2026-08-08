import { BotSpecification } from '@platform/bot-registry';
import { SalesAssistantBot, scoreLead } from '../employees/sales-assistant';
import { CrmLead } from '../lib/crm-store';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-24',
    role: 'Test Sales Assistant used to verify real lead-completeness scoring.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Sales Assistant used to verify real objective scoring.',
    permissionScope: ['read:crm-leads'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function lead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    id: 'lead-1',
    tenantId: 'tenant-1',
    companyName: 'Acme Co',
    contactName: 'Jane Smith',
    contactEmail: null,
    stage: 'new',
    estimatedValue: null,
    source: null,
    notes: null,
    ...overrides,
  };
}

describe('scoreLead (pure real completeness scoring)', () => {
  it('scores a genuinely complete lead at 100', () => {
    const result = scoreLead(
      lead({ contactEmail: 'x@y.com', estimatedValue: 5000, notes: 'met at conference', source: 'referral' }),
    );
    expect(result.score).toBe(100);
  });

  it('scores a genuinely bare-minimum lead at 0', () => {
    const result = scoreLead(lead());
    expect(result.score).toBe(0);
  });

  it('scores a partially complete lead correctly', () => {
    const result = scoreLead(lead({ contactEmail: 'x@y.com', estimatedValue: 1000 }));
    expect(result.score).toBe(60);
  });
});

describe('SalesAssistantBot', () => {
  describe('scoreLeads', () => {
    it('produces real scores for multiple real leads', async () => {
      const bot = new SalesAssistantBot(makeSpec());
      const results = await bot.scoreLeads([
        lead({ id: 'a', contactEmail: 'x@y.com', estimatedValue: 5000, notes: 'x', source: 'referral' }),
        lead({ id: 'b' }),
      ]);

      expect(results.find((r) => r.leadId === 'a')?.score).toBe(100);
      expect(results.find((r) => r.leadId === 'b')?.score).toBe(0);
    });

    it('blocks scoring without read:crm-leads permission', async () => {
      const bot = new SalesAssistantBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scoreLeads([lead()])).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
