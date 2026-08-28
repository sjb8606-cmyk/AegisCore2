/**
 * platform/policy-ack-tracker (HR-04)
 *
 * Policy versions (handbook, safety) + employee acknowledgements.
 * assertPoliciesCurrent blocks until required policies are acked.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('policy-ack-tracker');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockWhenUnacked: z.boolean().default(true),
});

export interface PolicyVersion {
  id: string;
  tenantId: string;
  policyKey: string;
  version: string;
  title: string;
  bodyHash: string;
  required: boolean;
  active: boolean;
  effectiveAt: string;
  createdAt: string;
}

export interface PolicyAck {
  id: string;
  tenantId: string;
  employeeId: string;
  policyVersionId: string;
  policyKey: string;
  version: string;
  ackedAt: string;
  actorId: string;
}

const policies = new Map<string, PolicyVersion>();
const acks = new Map<string, PolicyAck>();

export function __resetPolicyAckStore(): void {
  policies.clear();
  acks.clear();
}

function ackKey(
  tenantId: string,
  employeeId: string,
  policyVersionId: string,
): string {
  return tenantId + ':' + employeeId + ':' + policyVersionId;
}

export async function publishPolicyVersion(
  tenantId: string,
  actorId: string,
  input: {
    policyKey: string;
    version: string;
    title: string;
    bodyHash: string;
    required?: boolean;
    makeActive?: boolean;
  },
): Promise<PolicyVersion> {
  return runCrudOperation({
    configName: 'policy-ack-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !input.policyKey?.trim() ||
        !input.version?.trim() ||
        !input.title?.trim() ||
        !input.bodyHash?.trim()
      ) {
        throw new AppError(
          'policyKey, version, title, bodyHash required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const policyKey = input.policyKey.trim().toLowerCase();
      const version = input.version.trim();
      const dup = [...policies.values()].find(
        (p) =>
          p.tenantId === tenantId &&
          p.policyKey === policyKey &&
          p.version === version,
      );
      if (dup) {
        throw new AppError('Policy version already exists', ErrorCode.CONFLICT);
      }
      if (input.makeActive !== false) {
        for (const [id, p] of policies) {
          if (
            p.tenantId === tenantId &&
            p.policyKey === policyKey &&
            p.active
          ) {
            p.active = false;
            policies.set(id, p);
          }
        }
      }
      const row: PolicyVersion = {
        id: crypto.randomUUID(),
        tenantId,
        policyKey,
        version,
        title: input.title.trim(),
        bodyHash: input.bodyHash.trim(),
        required: input.required !== false,
        active: input.makeActive !== false,
        effectiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      policies.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'hr_policy_version',
    meterEventType: 'api_call',
  });
}

export async function acknowledgePolicy(
  tenantId: string,
  actorId: string,
  input: { employeeId: string; policyVersionId: string },
): Promise<PolicyAck> {
  return runCrudOperation({
    configName: 'policy-ack-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.employeeId?.trim()) {
        throw new AppError('employeeId required', ErrorCode.BAD_REQUEST);
      }
      const ver = policies.get(input.policyVersionId);
      if (!ver || ver.tenantId !== tenantId) {
        throw new AppError('Policy version not found', ErrorCode.NOT_FOUND);
      }
      const k = ackKey(tenantId, input.employeeId, ver.id);
      if (acks.has(k)) {
        throw new AppError('Already acknowledged', ErrorCode.CONFLICT);
      }
      const ack: PolicyAck = {
        id: crypto.randomUUID(),
        tenantId,
        employeeId: input.employeeId,
        policyVersionId: ver.id,
        policyKey: ver.policyKey,
        version: ver.version,
        ackedAt: new Date().toISOString(),
        actorId,
      };
      acks.set(k, ack);
      logger.info(
        { employeeId: input.employeeId, policyKey: ver.policyKey, version: ver.version },
        'Policy acknowledged',
      );
      return ack;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hr_policy_ack',
    meterEventType: 'api_call',
  });
}

export async function listActiveRequiredPolicies(
  tenantId: string,
): Promise<PolicyVersion[]> {
  return [...policies.values()].filter(
    (p) => p.tenantId === tenantId && p.active && p.required,
  );
}

export async function assertPoliciesCurrent(
  tenantId: string,
  employeeId: string,
): Promise<{ current: boolean; missing: Array<{ policyKey: string; version: string }> }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('policy-ack-tracker', ConfigSchema);
  const required = await listActiveRequiredPolicies(tenantId);
  const missing: Array<{ policyKey: string; version: string }> = [];
  for (const p of required) {
    if (!acks.has(ackKey(tenantId, employeeId, p.id))) {
      missing.push({ policyKey: p.policyKey, version: p.version });
    }
  }
  if (missing.length > 0 && config.blockWhenUnacked) {
    throw new AppError(
      'Unacknowledged policies: ' +
        missing.map((m) => m.policyKey + '@' + m.version).join(', '),
      ErrorCode.FORBIDDEN,
    );
  }
  return { current: missing.length === 0, missing };
}

export async function getEmployeeAckStatus(
  tenantId: string,
  actorId: string,
  employeeId: string,
): Promise<{
  required: PolicyVersion[];
  ackedVersionIds: string[];
  missing: Array<{ policyKey: string; version: string }>;
}> {
  return runCrudOperation({
    configName: 'policy-ack-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const required = await listActiveRequiredPolicies(tenantId);
      const ackedVersionIds = required
        .filter((p) => acks.has(ackKey(tenantId, employeeId, p.id)))
        .map((p) => p.id);
      const missing = required
        .filter((p) => !acks.has(ackKey(tenantId, employeeId, p.id)))
        .map((p) => ({ policyKey: p.policyKey, version: p.version }));
      return { required, ackedVersionIds, missing };
    },
    auditAction: 'data.read',
    auditResource: 'hr_policy_ack',
    meterEventType: 'api_call',
  });
}
