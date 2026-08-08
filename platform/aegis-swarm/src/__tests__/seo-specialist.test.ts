import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { SeoSpecialistBot, scanSeo } from '../employees/seo-specialist';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-22',
    role: 'Test SEO Specialist used to verify real on-page SEO scanning.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only SEO Specialist used to verify real regex-based scanning.',
    permissionScope: ['read:page-html'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const GOOD_SEO_HTML =
  '<title>A Great Page Title Here</title><meta name="description" content="A real description"><h1>Heading</h1>';
const BAD_SEO_HTML = '<title>x</title><h1>One</h1><h1>Two</h1>';

describe('scanSeo (pure real regex scanning)', () => {
  it('finds zero issues on a genuinely good SEO page', () => {
    expect(scanSeo(GOOD_SEO_HTML)).toHaveLength(0);
  });

  it('catches a real too-short title', () => {
    expect(scanSeo(BAD_SEO_HTML)).toContain('title_length_out_of_range');
  });

  it('catches a real missing meta description', () => {
    expect(scanSeo(BAD_SEO_HTML)).toContain('missing_meta_description');
  });

  it('catches real multiple H1 tags', () => {
    expect(scanSeo(BAD_SEO_HTML)).toContain('multiple_h1');
  });

  it('catches a real missing title', () => {
    expect(scanSeo('<h1>Only heading</h1>')).toContain('missing_title');
  });
});

describe('SeoSpecialistBot', () => {
  describe('scanPage', () => {
    it('reports clean for a genuinely good SEO page', async () => {
      const bot = new SeoSpecialistBot(makeSpec());
      const report = await bot.scanPage(GOOD_SEO_HTML);
      expect(report.clean).toBe(true);
    });

    it('signals the swarm on real findings', async () => {
      const bot = new SeoSpecialistBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.scanPage(BAD_SEO_HTML);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks scanning without read:page-html permission', async () => {
      const bot = new SeoSpecialistBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanPage(GOOD_SEO_HTML)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
