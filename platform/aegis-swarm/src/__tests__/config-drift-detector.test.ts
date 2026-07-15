import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ConfigDriftDetectorBot } from '../bots/config-drift-detector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-20',
    role: 'Test config drift detector used to verify baseline comparison logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only config drift detector used to verify baseline recording and drift comparison logic end to end.',
    permissionScope: ['read:filesystem', 'read:config-baseline', 'write:config-baseline'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('ConfigDriftDetectorBot', () => {
  let configDir: string;
  let baselinePath: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-drift-test-'));
    baselinePath = path.join(os.tmpdir(), `baseline-${Date.now()}.json`);
    fs.writeFileSync(path.join(configDir, 'app.json'), JSON.stringify({ port: 3000 }));
    fs.writeFileSync(path.join(configDir, 'security.json'), JSON.stringify({ mfa: true }));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    if (fs.existsSync(baselinePath)) fs.rmSync(baselinePath);
  });

  it('reports a warning finding when no baseline exists yet', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    const report = await bot.detectDrift(configDir, baselinePath);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('warn');
    expect(report.findings[0].desc).toContain('No baseline file found');
  });

  it('records a baseline and finds zero drift immediately after', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    await bot.recordBaseline(configDir, baselinePath);

    const report = await bot.detectDrift(configDir, baselinePath);
    expect(report.findings).toHaveLength(0);
    expect(report.filesChecked).toBe(2);
  });

  it('detects a modified file as crit severity', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    await bot.recordBaseline(configDir, baselinePath);

    fs.writeFileSync(path.join(configDir, 'app.json'), JSON.stringify({ port: 9999 }));

    const report = await bot.detectDrift(configDir, baselinePath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('crit');
    expect(report.findings[0].loc).toBe('app.json');
  });

  it('detects a deleted baseline file as block severity', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    await bot.recordBaseline(configDir, baselinePath);

    fs.rmSync(path.join(configDir, 'security.json'));

    const report = await bot.detectDrift(configDir, baselinePath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('block');
    expect(report.findings[0].loc).toBe('security.json');
  });

  it('detects a new file not in the baseline as warn severity', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    await bot.recordBaseline(configDir, baselinePath);

    fs.writeFileSync(path.join(configDir, 'extra.json'), JSON.stringify({ new: true }));

    const report = await bot.detectDrift(configDir, baselinePath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('warn');
    expect(report.findings[0].loc).toBe('extra.json');
  });

  it('blocks recordBaseline without write:config-baseline permission', async () => {
    const bot = new ConfigDriftDetectorBot(
      makeSpec({ permissionScope: ['read:filesystem', 'read:config-baseline'] }),
    );
    await expect(bot.recordBaseline(configDir, baselinePath)).rejects.toThrow(
      'outside its declared permissionScope',
    );
  });

  it('signals the swarm when crit or block severity drift is found', async () => {
    const bot = new ConfigDriftDetectorBot(makeSpec());
    await bot.recordBaseline(configDir, baselinePath);
    fs.writeFileSync(path.join(configDir, 'app.json'), JSON.stringify({ port: 9999 }));

    const received: unknown[] = [];
    const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

    await bot.detectDrift(configDir, baselinePath);

    expect(received).toHaveLength(1);
    unsubscribe();
  });
});
