import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { DatabaseBoundaryTesterBot } from '../redteam/database-boundary-tester';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-23',
    role: 'Test Database Boundary Tester used to verify the tenantId scanner against fixtures and the real lib directory.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Database Boundary Tester used to verify accurate flagging of bare tenantId parameters.',
    permissionScope: ['redteam:scan-database-boundary'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_LIB_DIR = path.join(__dirname, '..', 'lib');

describe('DatabaseBoundaryTesterBot', () => {
  describe('scanForUnverifiedTenantId — synthetic fixture', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-fixture-'));
      fs.writeFileSync(
        path.join(tmpDir, 'fixture-store.ts'),
        `
export async function unsafeRead(tenantId: string, id: string): Promise<null> {
  return null;
}

export async function noTenantParam(id: string): Promise<null> {
  return null;
}
`.trim(),
      );
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('flags a function with a bare tenantId parameter', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      const report = await bot.scanForUnverifiedTenantId(tmpDir);

      const flagged = report.findings.map((f) => f.functionName);
      expect(flagged).toContain('unsafeRead');
    });

    it('does not flag a function with no tenantId parameter at all', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      const report = await bot.scanForUnverifiedTenantId(tmpDir);

      const flagged = report.findings.map((f) => f.functionName);
      expect(flagged).not.toContain('noTenantParam');
    });
  });

  describe('scanForUnverifiedTenantId — real store modules', () => {
    it('finds all 10 known functions across the three real store modules', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      const report = await bot.scanForUnverifiedTenantId(REAL_LIB_DIR);

      expect(report.findings.length).toBeGreaterThanOrEqual(10);
      const flagged = report.findings.map((f) => f.functionName);
      expect(flagged).toContain('requestPurge');
      expect(flagged).toContain('openIncident');
      expect(flagged).toContain('recordRefusal');
    });
  });

  describe('attemptCrossTenantRead', () => {
    it('throws an honest error rather than claiming untested RLS coverage', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      await expect(bot.attemptCrossTenantRead()).rejects.toThrow('no live Postgres connection');
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.scanForUnverifiedTenantId(REAL_LIB_DIR);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus when findings exist', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.scanForUnverifiedTenantId(REAL_LIB_DIR);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks scanning without redteam:scan-database-boundary permission', async () => {
      const bot = new DatabaseBoundaryTesterBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanForUnverifiedTenantId(REAL_LIB_DIR)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
