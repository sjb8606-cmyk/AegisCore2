import { z } from 'zod';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

// ── Rule schema (Universal Spec v3.6 rule-authoring format) ────

const ComparisonOperator = z.enum([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'exists',
]);

export type Condition =
  | { field: string; op: z.infer<typeof ComparisonOperator>; value?: unknown }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ field: z.string(), op: ComparisonOperator, value: z.any().optional() }),
    z.object({ and: z.array(ConditionSchema).min(1) }),
    z.object({ or: z.array(ConditionSchema).min(1) }),
    z.object({ not: ConditionSchema }),
  ]),
);

export const RuleSchema = z.object({
  name: z.string().optional(),
  when: ConditionSchema,
});

export type Rule = z.infer<typeof RuleSchema>;

// ── Evaluation ──────────────────────────────────────────────────

function getFieldValue(context: any, field: string): unknown {
  return field
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), context);
}

function evaluateCondition(condition: Condition, context: any): boolean {
  if ('and' in condition) {
    return condition.and.every((c) => evaluateCondition(c, context));
  }
  if ('or' in condition) {
    return condition.or.some((c) => evaluateCondition(c, context));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, context);
  }

  const actual = getFieldValue(context, condition.field);

  switch (condition.op) {
    case 'eq':       return actual === condition.value;
    case 'neq':      return actual !== condition.value;
    case 'gt':       return typeof actual === 'number' && actual > (condition.value as number);
    case 'gte':      return typeof actual === 'number' && actual >= (condition.value as number);
    case 'lt':       return typeof actual === 'number' && actual < (condition.value as number);
    case 'lte':      return typeof actual === 'number' && actual <= (condition.value as number);
    case 'in':       return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'nin':      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case 'contains': return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    case 'exists':   return actual !== undefined && actual !== null;
    default:         return false;
  }
}

/**
 * Evaluate a rule (JSON string, Universal Spec v3.6 rule-authoring format)
 * against a context object. Rules are validated against RuleSchema before
 * evaluation — malformed rules throw rather than silently passing.
 */
export async function evaluate(rule: string, context: any): Promise<boolean> {
  let parsedRule: unknown;
  try {
    parsedRule = JSON.parse(rule);
  } catch {
    throw new AppError('Rule must be valid JSON', ErrorCode.BAD_REQUEST);
  }

  const result = RuleSchema.safeParse(parsedRule);
  if (!result.success) {
    throw new AppError('Rule failed schema validation', ErrorCode.UNPROCESSABLE, result.error.errors);
  }

  return evaluateCondition(result.data.when, context ?? {});
}
