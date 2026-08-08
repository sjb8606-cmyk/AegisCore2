import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { InvoiceManagerBot, classifyAging, Invoice } from '../employees/invoice-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-35',
    role: 'Test Invoice Manager used to verify real aging classification.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Invoice Manager used to verify real aging-bucket logic.',
    permissionScope: ['read:invoices'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const NOW = new Date('2026-08-07').getTime();

describe('classifyAging (pure real aging classification)', () => {
  it('classifies a not-yet-due invoice as current', () => {
    expect(classifyAging(new Date('2026-08-10').getTime(), NOW)).toBe('current');
  });

  it('classifies a real 15-days-overdue invoice correctly', () => {
    expect(classifyAging(new Date('2026-07-23').getTime(), NOW)).toBe('0-30');
  });

  it('classifies a real 45-days-overdue invoice correctly', () => {
    expect(classifyAging(new Date('2026-06-23').getTime(), NOW)).toBe('31-60');
  });

  it('classifies a real 120-days-overdue invoice correctly', () => {
    expect(classifyAging(new Date('2026-04-09').getTime(), NOW)).toBe('90+');
  });
});

describe('InvoiceManagerBot', () => {
  const invoices: Invoice[] = [
    { id: 'a', dueDateMs: new Date('2026-08-10').getTime(), amount: 500 },
    { id: 'b', dueDateMs: new Date('2026-04-09').getTime(), amount: 1200 },
  ];

  describe('runAgingReport', () => {
    it('sorts real invoices into the correct buckets', async () => {
      const bot = new InvoiceManagerBot(makeSpec());
      const report = await bot.runAgingReport(invoices, NOW);

      expect(report.current.map((i) => i.id)).toEqual(['a']);
      expect(report.bucket90plus.map((i) => i.id)).toEqual(['b']);
      expect(report.totalOverdueAmount).toBe(1200);
    });

    it('signals the swarm on a real severe-overdue invoice', async () => {
      const bot = new InvoiceManagerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.runAgingReport(invoices, NOW);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks the report without read:invoices permission', async () => {
      const bot = new InvoiceManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.runAgingReport(invoices, NOW)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
