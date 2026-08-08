import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  LegalDisclosureCheckerBot,
  checkDisclosures,
  RequiredDisclosure,
} from '../employees/legal-disclosure-checker';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-18',
    role: 'Test Legal Disclosure Checker used to verify real pattern matching.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Legal Disclosure Checker used to verify real presence checks.',
    permissionScope: ['read:page-text'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REQUIRED: RequiredDisclosure[] = [
  { name: 'Privacy Policy', patterns: ['privacy policy'] },
  { name: 'Terms of Service', patterns: ['terms of service', 'terms and conditions'] },
  { name: 'Cookie Notice', patterns: ['cookie', 'cookies'] },
];

const FULL_PAGE = 'Read our privacy policy and terms of service. This site uses cookies.';
const INCOMPLETE_PAGE = 'Read our privacy policy.';

describe('checkDisclosures (pure pattern matching)', () => {
  it('finds all disclosures present in a complete page', () => {
    const results = checkDisclosures(FULL_PAGE, REQUIRED);
    expect(results.every((r) => r.found)).toBe(true);
  });

  it('correctly flags a genuinely missing disclosure', () => {
    const results = checkDisclosures(INCOMPLETE_PAGE, REQUIRED);
    const cookie = results.find((r) => r.disclosure === 'Cookie Notice');
    expect(cookie?.found).toBe(false);
  });
});

describe('LegalDisclosureCheckerBot', () => {
  describe('checkPage', () => {
    it('reports complete when every disclosure is present', async () => {
      const bot = new LegalDisclosureCheckerBot(makeSpec());
      const report = await bot.checkPage(FULL_PAGE, REQUIRED);
      expect(report.complete).toBe(true);
    });

    it('reports real missing disclosures by name', async () => {
      const bot = new LegalDisclosureCheckerBot(makeSpec());
      const report = await bot.checkPage(INCOMPLETE_PAGE, REQUIRED);
      expect(report.missingDisclosures).toEqual(
        expect.arrayContaining(['Terms of Service', 'Cookie Notice']),
      );
    });

    it('signals the swarm when disclosures are missing', async () => {
      const bot = new LegalDisclosureCheckerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkPage(INCOMPLETE_PAGE, REQUIRED);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks checking without read:page-text permission', async () => {
      const bot = new LegalDisclosureCheckerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.checkPage(FULL_PAGE, REQUIRED)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
