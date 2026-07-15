/**
 * platform/aegis-swarm/src/bots/build-integrity-verifier.ts
 *
 * D-17 — Build Integrity Verifier.
 *
 * Verifies that a build output directory matches the manifest recorded
 * at build time — same hash-comparison shape as D-20, but the manifest
 * also carries provenance (which commit produced this build, and when),
 * so a mismatch means "this isn't the artifact the pipeline actually
 * built," not just "a config file changed."
 *
 * recordBuildManifest should only ever be called by the trusted build
 * step itself, immediately after compilation — never manually, never
 * on a schedule, since its whole purpose is capturing what a specific
 * build produced at the moment it was produced.
 */

import fs from 'fs';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { hashDirectory } from '../lib/hash-directory';

export interface BuildManifest {
  files: Record<string, string>;
  commitSha: string;
  builtAt: string;
}

export interface BuildVerificationReport {
  findings: Finding[];
  filesChecked: number;
  manifestCommitSha: string | null;
}

export class BuildIntegrityVerifierBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async verifyBuildIntegrity(buildDir: string, manifestPath: string): Promise<BuildVerificationReport> {
    await this.enforcePermission('read:filesystem');
    await this.enforcePermission('read:build-manifest');

    if (!fs.existsSync(manifestPath)) {
      const findings: Finding[] = [
        {
          cat: 'proc',
          sev: 'block',
          loc: manifestPath,
          desc: 'No build manifest found — this build has no recorded provenance and cannot be verified.',
          rec: 'This build should not be deployed until the build pipeline records a manifest for it.',
        },
      ];
      await this.createDecision({ buildDir, manifestPath }, { findings }, 'build-integrity-v1');
      return { findings, filesChecked: 0, manifestCommitSha: null };
    }

    const manifest: BuildManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const currentHashes = hashDirectory(buildDir);
    const findings: Finding[] = [];

    for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
      const currentHash = currentHashes[relPath];
      if (currentHash === undefined) {
        findings.push({
          cat: 'proc',
          sev: 'block',
          loc: relPath,
          desc: 'Build artifact listed in the manifest is missing from the build output.',
          rec: 'Do not deploy. Rebuild from the recorded commit and re-verify.',
        });
      } else if (currentHash !== expectedHash) {
        findings.push({
          cat: 'proc',
          sev: 'block',
          loc: relPath,
          desc: 'Build artifact hash does not match the manifest — the output has changed since it was built.',
          rec: 'Do not deploy this artifact. Something modified the build output after compilation, or the manifest is stale. Rebuild and re-verify.',
        });
      }
    }

    for (const relPath of Object.keys(currentHashes)) {
      if (!(relPath in manifest.files)) {
        findings.push({
          cat: 'proc',
          sev: 'crit',
          loc: relPath,
          desc: 'Build output contains a file not listed in the manifest.',
          rec: 'Investigate why this file exists. It may indicate the build produced unexpected output or was tampered with post-build.',
        });
      }
    }

    const pi = this.computePI(findings);
    await this.createDecision(
      { buildDir, manifestPath, commitSha: manifest.commitSha },
      { findingCount: findings.length, pi },
      'build-integrity-v1',
    );

    if (findings.some((f) => f.sev === 'block')) {
      await this.signalSwarm('build.integrity_failure', {
        botId: this.botId,
        commitSha: manifest.commitSha,
        blockCount: findings.filter((f) => f.sev === 'block').length,
      });
    }

    return {
      findings,
      filesChecked: Object.keys(currentHashes).length,
      manifestCommitSha: manifest.commitSha,
    };
  }

  /**
   * WRITES a build manifest. Must only be called by the trusted build
   * pipeline itself, immediately after compilation — never manually,
   * never on a schedule.
   */
  async recordBuildManifest(
    buildDir: string,
    manifestPath: string,
    commitSha: string,
  ): Promise<{ filesRecorded: number }> {
    await this.enforcePermission('write:build-manifest');

    const files = hashDirectory(buildDir);
    const manifest: BuildManifest = {
      files,
      commitSha,
      builtAt: new Date().toISOString(),
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    await this.createDecision(
      { buildDir, manifestPath, commitSha },
      { filesRecorded: Object.keys(files).length },
      'build-integrity-v1',
    );

    return { filesRecorded: Object.keys(files).length };
  }
}
