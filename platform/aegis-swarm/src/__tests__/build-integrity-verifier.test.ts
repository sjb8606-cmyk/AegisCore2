import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { BuildIntegrityVerifierBot } from '../bots/build-integrity-verifier';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-17',
    role: 'Test build integrity verifier used to verify manifest comparison and provenance logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only build integrity verifier used to verify manifest recording, hash comparison, and commit provenance end to end.',
    permissionScope: ['read:filesystem', 'read:build-manifest', 'write:build-manifest'],
    hitlClassification: 'Synchronous Gate',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const FAKE_COMMIT_SHA = 'abc1234def5678';

describe('BuildIntegrityVerifierBot', () => {
  let buildDir: string;
  let manifestPath: string;

  beforeEach(() => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-integrity-test-'));
    manifestPath = path.join(os.tmpdir(), `manifest-${Date.now()}.json`);
    fs.writeFileSync(path.join(buildDir, 'main.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(buildDir, 'index.html'), '<html></html>');
  });

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
    if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
  });

  it('reports a block finding when no manifest exists', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    const report = await bot.verifyBuildIntegrity(buildDir, manifestPath);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('block');
    expect(report.manifestCommitSha).toBeNull();
  });

  it('records a manifest with commit provenance and verifies clean immediately after', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    await bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA);

    const report = await bot.verifyBuildIntegrity(buildDir, manifestPath);
    expect(report.findings).toHaveLength(0);
    expect(report.manifestCommitSha).toBe(FAKE_COMMIT_SHA);
    expect(report.filesChecked).toBe(2);
  });

  it('detects a build artifact that changed after the manifest was recorded', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    await bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA);

    fs.writeFileSync(path.join(buildDir, 'main.js'), 'console.log("tampered");');

    const report = await bot.verifyBuildIntegrity(buildDir, manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('block');
    expect(report.findings[0].loc).toBe('main.js');
  });

  it('detects a missing build artifact as block severity', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    await bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA);

    fs.rmSync(path.join(buildDir, 'index.html'));

    const report = await bot.verifyBuildIntegrity(buildDir, manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('block');
  });

  it('detects an unexpected extra file as crit severity, not block', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    await bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA);

    fs.writeFileSync(path.join(buildDir, 'unexpected.js'), 'alert(1);');

    const report = await bot.verifyBuildIntegrity(buildDir, manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sev).toBe('crit');
  });

  it('blocks recordBuildManifest without write:build-manifest permission', async () => {
    const bot = new BuildIntegrityVerifierBot(
      makeSpec({ permissionScope: ['read:filesystem', 'read:build-manifest'] }),
    );
    await expect(bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA)).rejects.toThrow(
      'outside its declared permissionScope',
    );
  });

  it('signals the swarm when a block-severity integrity failure is found', async () => {
    const bot = new BuildIntegrityVerifierBot(makeSpec());
    await bot.recordBuildManifest(buildDir, manifestPath, FAKE_COMMIT_SHA);
    fs.writeFileSync(path.join(buildDir, 'main.js'), 'console.log("tampered");');

    const received: unknown[] = [];
    const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

    await bot.verifyBuildIntegrity(buildDir, manifestPath);

    expect(received).toHaveLength(1);
    unsubscribe();
  });
});
