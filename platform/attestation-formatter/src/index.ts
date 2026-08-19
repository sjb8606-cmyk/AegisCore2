/**
 * platform/attestation-formatter
 *
 * D-24 · Attestation Formatter
 * Closes gate: SBOM-01 (+ SLSA/in-toto correction)
 *
 * Wraps SBOM / build-manifest output from D-02 / D-17 into a
 * standard in-toto Statement with an SLSA Provenance v1 predicate.
 * Does NOT regenerate SBOMs or re-verify builds — pure reformat.
 *
 * builder.id is populated honestly: until D-25 (Pipeline Gateway)
 * exists there is no CI runner, so we identify the path as local/manual.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { signArtifact, formatDetachedSig, type SignResult } from '@platform/artifact-signer';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('attestation-formatter');

// ── Config ───────────────────────────────────────────────────

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Honest builder identity.
   * Until a real CI system is wired (D-25), this must NOT claim
   * a hosted runner. Default reflects local/manual builds.
   */
  builderId: z.string().default('https://crucible.local/builder/manual'),
  buildType: z.string().default('https://crucible.local/buildTypes/manual'),
});

export type AttestationFormatterConfig = z.infer<typeof ConfigSchema>;

// ── Input shapes (minimal, from D-02 / D-17) ─────────────────

export interface SbomSubject {
  /** Logical name of the artifact (e.g. package name or image ref) */
  name: string;
  /** SHA-256 digest of the artifact bytes, prefixed with "sha256:" */
  digest: {
    sha256: string;
  };
}

export interface SbomInput {
  /** Already-generated SBOM document (CycloneDX / SPDX JSON, etc.) */
  sbom: Record<string, unknown>;
  /** Subjects the SBOM covers */
  subjects: SbomSubject[];
  /** Optional: when the build/SBOM generation occurred */
  buildStartedOn?: string;
  buildFinishedOn?: string;
}

export interface BuildManifestInput {
  /** Manifest produced by D-17 */
  manifest: Record<string, unknown>;
  subjects: SbomSubject[];
  buildStartedOn?: string;
  buildFinishedOn?: string;
}

// ── in-toto / SLSA types (only fields defined by the specs) ──

/** in-toto Statement envelope */
export interface InTotoStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{
    name: string;
    digest: { sha256: string };
  }>;
  predicateType: 'https://slsa.dev/provenance/v1';
  predicate: SlsaProvenanceV1;
}

/**
 * SLSA Provenance v1 predicate — only standard fields.
 * See https://slsa.dev/spec/v1/provenance
 */
export interface SlsaProvenanceV1 {
  buildDefinition: {
    buildType: string;
    externalParameters: Record<string, unknown>;
    internalParameters?: Record<string, unknown>;
    resolvedDependencies?: Array<{
      uri?: string;
      digest?: { sha256: string };
    }>;
  };
  runDetails: {
    builder: {
      id: string;
    };
    metadata?: {
      invocationId?: string;
      startedOn?: string;
      finishedOn?: string;
    };
  };
}

export interface FormattedAttestation {
  statement: InTotoStatement;
  /** Canonical JSON of the statement (what gets hashed + signed) */
  statementJson: string;
  /** SHA-256 of statementJson */
  statementHash: string;
  /** Detached signature over the statement hash (from D-23) */
  signature: SignResult;
  /** Human-readable .sig sidecar text */
  detachedSig: string;
}

// ── Helpers ──────────────────────────────────────────────────

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Canonical JSON: stable key order so the same logical statement
 * always produces the same hash.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function buildProvenancePredicate(
  config: AttestationFormatterConfig,
  externalParameters: Record<string, unknown>,
  timestamps: { startedOn?: string; finishedOn?: string },
): SlsaProvenanceV1 {
  return {
    buildDefinition: {
      buildType: config.buildType,
      externalParameters,
    },
    runDetails: {
      builder: {
        id: config.builderId, // honest — manual/local until D-25
      },
      metadata: {
        invocationId: crypto.randomUUID(),
        startedOn: timestamps.startedOn,
        finishedOn: timestamps.finishedOn ?? new Date().toISOString(),
      },
    },
  };
}

function buildStatement(
  subjects: SbomSubject[],
  predicate: SlsaProvenanceV1,
): InTotoStatement {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: subjects.map((s) => ({
      name: s.name,
      digest: { sha256: s.digest.sha256.replace(/^sha256:/, '') },
    })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate,
  };
}

// ── Main API ─────────────────────────────────────────────────

/**
 * Format an SBOM (from D-02) into a signed in-toto + SLSA attestation.
 */
export async function formatSbomAttestation(
  tenantId: string,
  actorId: string,
  input: SbomInput,
): Promise<FormattedAttestation> {
  return runCrudOperation({
    configName: 'attestation-formatter',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      if (!input.subjects?.length) {
        throw new AppError('subjects array is required', ErrorCode.BAD_REQUEST);
      }
      for (const s of input.subjects) {
        if (!s.name || !s.digest?.sha256) {
          throw new AppError('each subject needs name + digest.sha256', ErrorCode.BAD_REQUEST);
        }
      }

      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('attestation-formatter', ConfigSchema);

      const predicate = buildProvenancePredicate(
        config,
        {
          // External parameters that influenced the build/SBOM.
          // Keep this minimal and honest — do not invent CI fields.
          source: 'sbom',
          sbomPresent: true,
        },
        {
          startedOn: input.buildStartedOn,
          finishedOn: input.buildFinishedOn,
        },
      );

      const statement = buildStatement(input.subjects, predicate);
      const statementJson = JSON.stringify(statement);
      const statementHash = sha256Hex(statementJson);

      // Hand the statement hash to D-23 for signing
      const signature = await signArtifact(tenantId, actorId, statementHash, {
        contentIsHash: true,
        botId: 'attestation-formatter',
      });

      const detachedSig = formatDetachedSig(signature);

      logger.info(
        {
          subjectCount: input.subjects.length,
          statementHash,
          builderId: config.builderId,
          decisionId: signature.decisionId,
        },
        'SBOM attestation formatted and signed',
      );

      return {
        statement,
        statementJson,
        statementHash,
        signature,
        detachedSig,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'attestation',
    auditMetadata: {
      predicateType: 'https://slsa.dev/provenance/v1',
      kind: 'sbom',
    },
    meterEventType: 'api_call',
  });
}

/**
 * Format a build manifest (from D-17) into a signed in-toto + SLSA attestation.
 */
export async function formatBuildAttestation(
  tenantId: string,
  actorId: string,
  input: BuildManifestInput,
): Promise<FormattedAttestation> {
  return runCrudOperation({
    configName: 'attestation-formatter',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      if (!input.subjects?.length) {
        throw new AppError('subjects array is required', ErrorCode.BAD_REQUEST);
      }

      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('attestation-formatter', ConfigSchema);

      const predicate = buildProvenancePredicate(
        config,
        {
          source: 'build-manifest',
          manifestPresent: true,
        },
        {
          startedOn: input.buildStartedOn,
          finishedOn: input.buildFinishedOn,
        },
      );

      const statement = buildStatement(input.subjects, predicate);
      const statementJson = JSON.stringify(statement);
      const statementHash = sha256Hex(statementJson);

      const signature = await signArtifact(tenantId, actorId, statementHash, {
        contentIsHash: true,
        botId: 'attestation-formatter',
      });

      const detachedSig = formatDetachedSig(signature);

      logger.info(
        {
          subjectCount: input.subjects.length,
          statementHash,
          builderId: config.builderId,
          decisionId: signature.decisionId,
        },
        'Build attestation formatted and signed',
      );

      return {
        statement,
        statementJson,
        statementHash,
        signature,
        detachedSig,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'attestation',
    auditMetadata: {
      predicateType: 'https://slsa.dev/provenance/v1',
      kind: 'build',
    },
    meterEventType: 'api_call',
  });
}
