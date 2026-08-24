/**
 * platform/research
 *
 * External-grounded research for Business Architect. Stores findings pulled
 * from outside the model's static knowledge (search results, registry
 * lookups, etc.) and forces every claim into a confidence taxonomy so a
 * generated business plan can never quietly pass off a guess as a fact.
 *
 * This core does NOT perform the web fetch itself — callers pass in
 * rawResults from whatever search provider is wired up. This core's job is
 * PII/adversarial filtering, claim extraction, confidence tagging, storage,
 * and audit — the part that has to be consistent no matter which search
 * provider is behind it.
 */
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';
import { filterPii, detectAdversarial } from '@platform/ai-safety';
import { generateText } from '@platform/ai-gateway';

export { AppError, ErrorCode };

export const CONFIDENCE_TAGS = [
  'known',
  'evidence_supported',
  'estimated',
  'assumption',
  'unknown',
] as const;
export type ConfidenceTag = (typeof CONFIDENCE_TAGS)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z
    .object({
      webSearch: z.boolean().default(true),
      govRegistries: z.boolean().default(false),
    })
    .default({}),
  limits: z
    .object({
      queriesPerRun: z.number().default(15),
      runsPerMonth: z.number().default(50),
    })
    .default({}),
  confidenceRequired: z.boolean().default(true),
});

export interface RawResearchResult {
  sourceUrl: string;
  sourceTitle: string;
  text: string;
}

export interface ResearchFinding {
  id: string;
  runId: string;
  query: string;
  sourceUrl: string;
  sourceTitle: string;
  claimText: string;
  confidenceTag: ConfidenceTag;
  retrievedAt: string;
}

/**
 * Runs one research query: filters raw source text for PII/adversarial
 * content, asks the model to extract discrete claims and confidence-tag
 * each one, then stores the findings.
 */
export async function runResearchQuery(
  tenantId: string,
  actorId: string,
  input: { ideaId: string; stage: string; query: string; rawResults: RawResearchResult[] },
) {
  return runCrudOperation({
    configName: 'research',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        `SELECT COUNT(*) as count FROM research_runs
         WHERE tenant_id = $1 AND created_at > now() - interval '30 days'`,
        [tenantId],
        tenantId,
      );
      enforceQuota(
        countRes[0]?.count,
        config.limits.runsPerMonth,
        'Monthly research run limit reached for this tenant.',
      );
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const runId = randomUUID();

      const cleanResults = input.rawResults.filter((r) => !detectAdversarial(r.text).detected);

      if (cleanResults.length === 0) {
        throw new AppError(
          'All research results were filtered as unsafe or adversarial; nothing to store.',
          ErrorCode.BAD_REQUEST,
        );
      }

      await withTenantQuery(
        `INSERT INTO research_runs (id, tenant_id, idea_id, stage, status, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [runId, tenantId, input.ideaId, input.stage, 'completed'],
        tenantId,
      );

      const findings: ResearchFinding[] = [];

      for (const result of cleanResults) {
        const { sanitized } = filterPii(result.text);

        const extraction = await generateText({
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content:
                'Extract discrete factual claims from the source text relevant to the research query. ' +
                'For each claim, assign exactly one confidence tag from: known, evidence_supported, ' +
                'estimated, assumption, unknown. Respond as JSON array of {claim, confidenceTag}.',
            },
            {
              role: 'user',
              content: `Query: ${input.query}\n\nSource (${result.sourceTitle}):\n${sanitized}`,
            },
          ],
          maxTokens: 800,
          temperature: 0,
        });

        let parsedClaims: { claim: string; confidenceTag: ConfidenceTag }[] = [];
        try {
          parsedClaims = JSON.parse(extraction.content);
        } catch {
          parsedClaims = [
            { claim: extraction.content.slice(0, 500), confidenceTag: 'unknown' },
          ];
        }

        for (const c of parsedClaims) {
          const findingId = randomUUID();
          const tag: ConfidenceTag = CONFIDENCE_TAGS.includes(c.confidenceTag)
            ? c.confidenceTag
            : 'unknown';

          await withTenantQuery(
            `INSERT INTO research_findings
              (id, run_id, tenant_id, query, source_url, source_title, claim_text, confidence_tag, retrieved_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
            [
              findingId,
              runId,
              tenantId,
              input.query,
              result.sourceUrl,
              result.sourceTitle,
              c.claim,
              tag,
            ],
            tenantId,
          );

          findings.push({
            id: findingId,
            runId,
            query: input.query,
            sourceUrl: result.sourceUrl,
            sourceTitle: result.sourceTitle,
            claimText: c.claim,
            confidenceTag: tag,
            retrievedAt: new Date().toISOString(),
          });
        }
      }

      return { runId, findings };
    },
    auditAction: 'research.query.executed',
    auditResource: 'research_run',
    meterEventType: 'ai_call',
  });
}

/** Read-only: all findings collected so far for a given pipeline stage. */
export async function getFindingsForStage(tenantId: string, ideaId: string, stage: string) {
  return withTenantQuery(
    `SELECT rf.* FROM research_findings rf
     JOIN research_runs rr ON rr.id = rf.run_id
     WHERE rf.tenant_id = $1 AND rr.idea_id = $2 AND rr.stage = $3
     ORDER BY rf.retrieved_at DESC`,
    [tenantId, ideaId, stage],
    tenantId,
  );
}

/**
 * Everything tagged assumption/unknown — the feed for the Red Team stage in
 * platform/risk-register, and the list the final plan must disclose rather
 * than smooth over.
 */
export async function flagUnverifiedClaims(tenantId: string, ideaId: string) {
  return withTenantQuery(
    `SELECT rf.* FROM research_findings rf
     JOIN research_runs rr ON rr.id = rf.run_id
     WHERE rf.tenant_id = $1 AND rr.idea_id = $2
       AND rf.confidence_tag IN ('assumption', 'unknown')
     ORDER BY rf.retrieved_at DESC`,
    [tenantId, ideaId],
    tenantId,
  );
}
