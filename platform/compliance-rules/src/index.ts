import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery, withTenant } from '@platform/tenancy';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { randomUUID } from 'crypto';

export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    rulesPerMonth: z.number(),
  }),
});

export interface RuleCondition {
  field: string;
  operator: 'gte' | 'lte' | 'eq' | 'in';
  value: unknown;
}

export async function createRuleVersion(
  tenantId: string,
  actorId: string,
  data: { ruleKey: string; name: string; description?: string; effectiveDate: string; definition: RuleCondition[] }
) {
  return runCrudOperation({
    configName: 'compliance-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        "SELECT COUNT(*) as count FROM compliance_rule_versions WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days'",
        [tenantId],
        tenantId,
      );
      enforceQuota(countRes[0]?.count, config.limits.rulesPerMonth, 'Monthly compliance rule version limit reached');
    },
    action: async () => {
      return withTenant(tenantId, async (client: any) => {
        const ruleRes = await client.query(
          'SELECT id FROM compliance_rules WHERE tenant_id = $1 AND rule_key = $2',
          [tenantId, data.ruleKey],
        );

        let ruleId: string;
        if (ruleRes.rows.length === 0) {
          const inserted = await client.query(
            'INSERT INTO compliance_rules (id, tenant_id, rule_key, name, description) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [randomUUID(), tenantId, data.ruleKey, data.name, data.description || null],
          );
          ruleId = inserted.rows[0].id;
        } else {
          ruleId = ruleRes.rows[0].id;
        }

        const latestVersionRes = await client.query(
          'SELECT version_number, hash FROM compliance_rule_versions WHERE rule_id = $1 ORDER BY version_number DESC LIMIT 1',
          [ruleId],
        );
        const previousHash = latestVersionRes.rows[0]?.hash ?? GENESIS_HASH;
        const nextVersionNumber = (latestVersionRes.rows[0]?.version_number ?? 0) + 1;

        const hash = computeChainHash(
          ruleId,
          'rule_version_created',
          { definition: data.definition, effectiveDate: data.effectiveDate },
          previousHash,
        );

        const versionRes = await client.query(
          `INSERT INTO compliance_rule_versions
             (id, tenant_id, rule_id, version_number, effective_date, definition, previous_hash, hash, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [randomUUID(), tenantId, ruleId, nextVersionNumber, data.effectiveDate, JSON.stringify(data.definition), previousHash, hash, actorId],
        );

        return { ruleId, ...versionRes.rows[0] };
      });
    },
    auditAction: 'compliance.rule_version_created',
    auditResource: 'compliance_rule_version',
    meterEventType: 'api_call',
  });
}

export async function evaluateAsOf(
  tenantId: string,
  ruleKey: string,
  asOfDate: string,
  inputData: Record<string, unknown>,
) {
  const ruleRes = await withTenantQuery(
    'SELECT id FROM compliance_rules WHERE tenant_id = $1 AND rule_key = $2',
    [tenantId, ruleKey],
    tenantId,
  );
  const rule = ruleRes[0];
  if (!rule) throw new AppError(`No compliance rule found for key "${ruleKey}"`, ErrorCode.NOT_FOUND);

  const versionRes = await withTenantQuery(
    `SELECT * FROM compliance_rule_versions
     WHERE tenant_id = $1 AND rule_id = $2 AND effective_date <= $3
     ORDER BY effective_date DESC, version_number DESC LIMIT 1`,
    [tenantId, rule.id, asOfDate],
    tenantId,
  );
  const version = versionRes[0];
  if (!version) {
    throw new AppError(`No version of rule "${ruleKey}" was effective as of ${asOfDate}`, ErrorCode.NOT_FOUND);
  }

  const conditions: RuleCondition[] =
    typeof version.definition === 'string' ? JSON.parse(version.definition) : version.definition;
  const failedConditions: RuleCondition[] = [];

  for (const cond of conditions) {
    const actual = inputData[cond.field];
    let pass = false;
    switch (cond.operator) {
      case 'gte': pass = typeof actual === 'number' && actual >= (cond.value as number); break;
      case 'lte': pass = typeof actual === 'number' && actual <= (cond.value as number); break;
      case 'eq': pass = actual === cond.value; break;
      case 'in': pass = Array.isArray(cond.value) && (cond.value as unknown[]).includes(actual); break;
    }
    if (!pass) failedConditions.push(cond);
  }

  return {
    passed: failedConditions.length === 0,
    ruleKey,
    versionNumber: version.version_number,
    effectiveDate: version.effective_date,
    failedConditions,
  };
}
