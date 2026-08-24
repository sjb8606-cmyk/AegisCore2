import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger(
  'expense-policy-compliance-flagging'
);

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  default_rules: z.array(
    z.object({
      id: z.string(),
      category: z.string().optional(),
      max_amount: z.number().positive().optional(),
      severity: z.enum([
        'warning',
        'requires_justification',
        'blocked'
      ])
    })
  ).default([])
});

export type FlagSeverity =
  | 'warning'
  | 'requires_justification'
  | 'blocked';

export interface ExpensePolicyRule {
  id: string;
  category?: string;
  max_amount?: number;
  severity: FlagSeverity;
  active: boolean;
}

export interface ExpensePolicyFlag {
  flag_id: string;
  tenant_id: string;
  expense_id: string;
  policy_rule_violated: string;
  flag_reason: string;
  severity: FlagSeverity;
  employee_justification?: string;
  overridden: boolean;
  overridden_by?: string;
  created_at: string;
  updated_at: string;
}

const ruleStore =
  new Map<string, ExpensePolicyRule>();

const flagStore =
  new Map<string, ExpensePolicyFlag>();

export function __resetExpensePolicyComplianceFlaggingStore(): void {
  ruleStore.clear();
  flagStore.clear();
}

function getConfig() {
  return loadConfig(
    'expense-policy-compliance-flagging',
    ConfigSchema
  );
}

function tenantRuleKey(
  tenantId: string,
  ruleId: string
): string {
  return `${tenantId}:${ruleId}`;
}

function getTenantRules(
  tenantId: string
): ExpensePolicyRule[] {
  return Array.from(
    ruleStore.entries()
  )
    .filter(([key]) =>
      key.startsWith(`${tenantId}:`)
    )
    .map(([, rule]) => rule)
    .filter(rule => rule.active);
}

export async function createPolicyRule(
  tenantId: string,
  actorId: string,
  rule: Omit<ExpensePolicyRule, 'active'>
): Promise<ExpensePolicyRule> {
  return runCrudOperation({
    configName: 'expense-policy-compliance-flagging',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!rule.id.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Policy rule ID is required'
        );
      }

      if (
        rule.max_amount !== undefined &&
        (
          !Number.isFinite(rule.max_amount) ||
          rule.max_amount <= 0
        )
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Maximum amount must be greater than zero'
        );
      }

      const record: ExpensePolicyRule = {
        ...rule,
        active: true
      };

      ruleStore.set(
        tenantRuleKey(tenantId, rule.id),
        record
      );

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'expense_policy_rule',
    meterEventType: 'api_call'
  });
}

export async function checkPolicyCompliance(
  tenantId: string,
  actorId: string,
  expenseId: string,
  amount: number,
  category: string
): Promise<ExpensePolicyFlag[]> {
  return runCrudOperation({
    configName: 'expense-policy-compliance-flagging',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Expense policy compliance flagging is disabled'
        );
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Expense amount must be greater than zero'
        );
      }

      const rules = getTenantRules(
        tenantId
      );

      /*
       * Configured tenant rules take precedence.
       * Platform defaults are used only when no tenant
       * override exists for that rule ID.
       */
      const configuredIds =
        new Set(
          rules.map(rule => rule.id)
        );

      const defaultRules =
        config.default_rules
          .filter(
            rule =>
              !configuredIds.has(rule.id)
          )
          .map(rule => ({
            ...rule,
            active: true
          }));

      const applicableRules = [
        ...rules,
        ...defaultRules
      ];

      const flags: ExpensePolicyFlag[] = [];

      for (const rule of applicableRules) {
        if (
          rule.category &&
          rule.category !== category
        ) {
          continue;
        }

        if (
          rule.max_amount === undefined ||
          amount <= rule.max_amount
        ) {
          continue;
        }

        const now =
          new Date().toISOString();

        const flag: ExpensePolicyFlag = {
          flag_id: crypto.randomUUID(),
          tenant_id: tenantId,
          expense_id: expenseId,
          policy_rule_violated: rule.id,
          flag_reason:
            `Expense exceeds policy maximum of ${rule.max_amount}`,
          severity: rule.severity,
          overridden: false,
          created_at: now,
          updated_at: now
        };

        flagStore.set(
          flag.flag_id,
          flag
        );

        flags.push(flag);
      }

      logger.info(
        'Expense policy compliance checked',
        {
          tenantId,
          expenseId,
          flagCount: flags.length
        }
      );

      return flags;
    },
    auditAction: 'data.read',
    auditResource: 'expense_policy_flag',
    meterEventType: 'api_call'
  });
}

export async function requestJustification(
  tenantId: string,
  actorId: string,
  flagId: string,
  justification: string
): Promise<ExpensePolicyFlag> {
  return runCrudOperation({
    configName: 'expense-policy-compliance-flagging',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const flag =
        flagStore.get(flagId);

      if (
        !flag ||
        flag.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense policy flag not found'
        );
      }

      if (!justification.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Employee justification is required'
        );
      }

      const updated: ExpensePolicyFlag = {
        ...flag,
        employee_justification:
          justification,
        updated_at:
          new Date().toISOString()
      };

      flagStore.set(
        flagId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'expense_policy_flag',
    meterEventType: 'api_call'
  });
}

export async function overrideFlag(
  tenantId: string,
  actorId: string,
  flagId: string,
  approverId: string
): Promise<ExpensePolicyFlag> {
  return runCrudOperation({
    configName: 'expense-policy-compliance-flagging',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const flag =
        flagStore.get(flagId);

      if (
        !flag ||
        flag.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense policy flag not found'
        );
      }

      if (!approverId.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Approver ID is required'
        );
      }

      const updated: ExpensePolicyFlag = {
        ...flag,
        overridden: true,
        overridden_by: approverId,
        updated_at:
          new Date().toISOString()
      };

      flagStore.set(
        flagId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'expense_policy_flag',
    meterEventType: 'api_call'
  });
}

export function getExpensePolicyFlags(
  tenantId: string,
  expenseId: string
): ExpensePolicyFlag[] {
  return Array.from(
    flagStore.values()
  ).filter(
    flag =>
      flag.tenant_id === tenantId &&
      flag.expense_id === expenseId
  );
}
