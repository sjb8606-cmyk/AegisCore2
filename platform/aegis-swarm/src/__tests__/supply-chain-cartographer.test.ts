import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { SupplyChainCartographerBot } from '../bots/supply-chain-cartographer';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-02',
    role: 'Test supply chain cartographer used to verify dependency graph mapping and SBOM export.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only supply chain cartographer used to verify internal/external classification, unbounded-version detection, and the honest signSbom() stub.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function writePkg(dir: string, name: string, content: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...content }));
}

describe('SupplyChainCartographerBot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartographer-test-'));

    writePkg(path.join(tmpDir, 'platform', 'audit'), '@platform/audit', {});
    writePkg(path.join(tmpDir, 'platform', 'bot-runtime'), '@platform/bot-runtime', {
      dependencies: { '@platform/audit': '*', zod: '^3.22.4' },
    });
    writePkg(path.join(tmpDir, 'apps', 'sketchy-app'), '@apps/sketchy-app', {
      dependencies: { 'left-pad': '*', lodash: '^4.17.21', 'some-cli-tool': 'latest' },
    });
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'ignored-pkg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'ignored-pkg', 'package.json'),
      JSON.stringify({ name: 'ignored-pkg', dependencies: { anything: '*' } }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('scanDependencyGraph', () => {
    it('does not flag internal workspace packages pinned to "*"', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      const flaggedDeps = report.findings.map((f) => f.desc);
      expect(flaggedDeps.some((d) => d.includes('@platform/audit'))).toBe(false);
    });

    it('flags an external dependency pinned to "*"', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      const flagged = report.findings.find((f) => f.desc.includes('left-pad'));
      expect(flagged).toBeDefined();
      expect(flagged?.sev).toBe('warn');
    });

    it('flags an external dependency pinned to "latest"', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      expect(report.findings.some((f) => f.desc.includes('some-cli-tool'))).toBe(true);
    });

    it('does not flag a properly scoped external dependency', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      expect(report.findings.some((f) => f.desc.includes('lodash'))).toBe(false);
      expect(report.findings.some((f) => f.desc.includes('zod'))).toBe(false);
    });

    it('skips node_modules entirely', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      expect(report.graph.some((e) => e.from === 'ignored-pkg')).toBe(false);
    });

    it('counts internal vs external packages correctly', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const report = await bot.scanDependencyGraph(tmpDir);

      expect(report.internalPackageCount).toBe(3);
      expect(report.externalPackageCount).toBe(4);
    });

    it('blocks scanning without read:filesystem permission', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanDependencyGraph(tmpDir)).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when an unbounded external dependency is found', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.scanDependencyGraph(tmpDir);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('skips a malformed package.json rather than failing the whole scan', async () => {
      fs.mkdirSync(path.join(tmpDir, 'apps', 'broken'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'apps', 'broken', 'package.json'), '{ not valid json');

      const bot = new SupplyChainCartographerBot(makeSpec());
      await expect(bot.scanDependencyGraph(tmpDir)).resolves.toBeDefined();
    });
  });

  describe('generateSbom', () => {
    it('produces a real, unsigned SBOM with correctly classified components', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const sbom = await bot.generateSbom(tmpDir);

      expect(sbom.signature).toBeNull();
      expect(sbom.signingStatus).toBe('unsigned-pqcrypto-not-yet-available');

      const byName = new Map(sbom.components.map((c) => [c.name, c]));
      expect(byName.get('@platform/audit')?.type).toBe('internal-workspace');
      expect(byName.get('left-pad')?.type).toBe('external');
      expect(byName.get('zod')?.type).toBe('external');
    });
  });

  describe('signSbom', () => {
    it('throws an honest error rather than faking a signature', async () => {
      const bot = new SupplyChainCartographerBot(makeSpec());
      const sbom = await bot.generateSbom(tmpDir);

      expect(() => bot.signSbom(sbom)).toThrow('@platform/pqcrypto has not been built');
    });
  });
});
