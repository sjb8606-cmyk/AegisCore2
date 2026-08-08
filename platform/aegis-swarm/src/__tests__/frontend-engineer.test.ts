import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { FrontendEngineerBot, scanAccessibility } from '../employees/frontend-engineer';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-21',
    role: 'Test Frontend Engineer used to verify real accessibility scanning.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Frontend Engineer used to verify real regex-based scanning.',
    permissionScope: ['read:page-html'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const CLEAN_HTML = '<img src="x.png" alt="A photo"><input id="name" type="text">';
const BROKEN_HTML = '<img src="x.png"><input type="text">';

describe('scanAccessibility (pure real regex scanning)', () => {
  it('finds zero issues in genuinely clean HTML', () => {
    expect(scanAccessibility(CLEAN_HTML)).toHaveLength(0);
  });

  it('catches a real missing alt attribute', () => {
    const findings = scanAccessibility(BROKEN_HTML);
    expect(findings.some((f) => f.type === 'missing_alt')).toBe(true);
  });

  it('catches a real input with no label association', () => {
    const findings = scanAccessibility(BROKEN_HTML);
    expect(findings.some((f) => f.type === 'missing_label_association')).toBe(true);
  });
});

describe('FrontendEngineerBot', () => {
  describe('scanPage', () => {
    it('reports clean for genuinely clean HTML', async () => {
      const bot = new FrontendEngineerBot(makeSpec());
      const report = await bot.scanPage(CLEAN_HTML);
      expect(report.clean).toBe(true);
    });

    it('signals the swarm on real findings', async () => {
      const bot = new FrontendEngineerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.scanPage(BROKEN_HTML);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks scanning without read:page-html permission', async () => {
      const bot = new FrontendEngineerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanPage(CLEAN_HTML)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
