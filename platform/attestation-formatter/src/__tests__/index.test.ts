/**
 * attestation-formatter tests
 * No outer consts inside vi.mock factories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      builderId: 'https://crucible.local/builder/manual',
      buildType: 'https://crucible.local/buildTypes/manual',
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@platform/artifact-signer', () => ({
  signArtifact: vi.fn().mockResolvedValue({
    signature: 'aa'.repeat(32),
    algorithm: 'ed25519',
    publicKey: 'bb'.repeat(32),
    contentHash: 'cc'.repeat(32),
    signedAt: new Date().toISOString(),
    decisionId: '00000000-0000-4000-8000-000000000099',
  }),
  formatDetachedSig: vi.fn().mockReturnValue(
    '-----BEGIN ARTIFACT SIGNATURE-----\nmock\n-----END ARTIFACT SIGNATURE-----',
  ),
}));

import { formatSbomAttestation, formatBuildAttestation } from '../index';
import { signArtifact } from '@platform/artifact-signer';

describe('formatSbomAttestation', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const actorId = 'service:supply-chain-cartographer';

  const baseInput = {
    sbom: { bomFormat: 'CycloneDX', specVersion: '1.5' },
    subjects: [
      {
        name: 'pkg:npm/example@1.0.0',
        digest: { sha256: 'a'.repeat(64) },
      },
    ],
    buildStartedOn: '2026-08-16T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an in-toto Statement with SLSA provenance v1 predicate', async () => {
    const result = await formatSbomAttestation(tenantId, actorId, baseInput);

    expect(result.statement._type).toBe('https://in-toto.io/Statement/v1');
    expect(result.statement.predicateType).toBe('https://slsa.dev/provenance/v1');
    expect(result.statement.subject).toHaveLength(1);
    expect(result.statement.subject[0].name).toBe('pkg:npm/example@1.0.0');
    expect(result.statement.subject[0].digest.sha256).toBe('a'.repeat(64));
  });

  it('uses the honest manual builder id by default', async () => {
    const result = await formatSbomAttestation(tenantId, actorId, baseInput);
    expect(result.statement.predicate.runDetails.builder.id).toBe(
      'https://crucible.local/builder/manual',
    );
  });

  it('passes a content hash to signArtifact (contentIsHash=true)', async () => {
    await formatSbomAttestation(tenantId, actorId, baseInput);
    expect(signArtifact).toHaveBeenCalledTimes(1);
    const call = (signArtifact as any).mock.calls[0];
    expect(call[3]).toEqual(
      expect.objectContaining({ contentIsHash: true, botId: 'attestation-formatter' }),
    );
    expect(call[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects empty subjects', async () => {
    await expect(
      formatSbomAttestation(tenantId, actorId, { sbom: {}, subjects: [] }),
    ).rejects.toThrow(/subjects/i);
  });

  it('includes detached signature text', async () => {
    const result = await formatSbomAttestation(tenantId, actorId, baseInput);
    expect(result.detachedSig).toContain('BEGIN ARTIFACT SIGNATURE');
    expect(result.signature.decisionId).toBe('00000000-0000-4000-8000-000000000099');
  });
});

describe('formatBuildAttestation', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const actorId = 'service:build-integrity-verifier';

  it('produces the same envelope shape for build manifests', async () => {
    const result = await formatBuildAttestation(tenantId, actorId, {
      manifest: { version: 1, steps: [] },
      subjects: [
        { name: 'app:backend', digest: { sha256: 'b'.repeat(64) } },
      ],
    });

    expect(result.statement.predicateType).toBe('https://slsa.dev/provenance/v1');
    expect(result.statement.predicate.buildDefinition.externalParameters).toEqual(
      expect.objectContaining({ source: 'build-manifest' }),
    );
  });
});
