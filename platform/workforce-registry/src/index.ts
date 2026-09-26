import {
  WorkforceDefinitionSchema,
  type WorkforceDefinition
} from '@platform/workforce-definition';

export type LegacyRefKind =
  | 'persona_id'
  | 'bot_id'
  | 'employee_id'
  | 'agent_id';

const LEGACY_REF_KINDS: readonly LegacyRefKind[] = [
  'persona_id',
  'bot_id',
  'employee_id',
  'agent_id'
];

function cloneDefinition(definition: WorkforceDefinition): WorkforceDefinition {
  return WorkforceDefinitionSchema.parse(structuredClone(definition));
}

/**
 * In-memory registry for canonical WorkforceDefinitions.
 *
 * The registry owns identity lookup and legacy-reference indexes only.
 * It does not execute modes, enforce authority, persist data, or translate
 * legacy persona/bot/employee records.
 */
export class WorkforceRegistry {
  private readonly definitions = new Map<string, WorkforceDefinition>();
  private readonly legacyIndexes: Record<
    LegacyRefKind,
    Map<string, Set<string>>
  > = {
    persona_id: new Map(),
    bot_id: new Map(),
    employee_id: new Map(),
    agent_id: new Map()
  };

  register(definition: unknown): WorkforceDefinition {
    const parsed = WorkforceDefinitionSchema.parse(definition);
    const { workforce_id, legacy_refs } = parsed;

    if (this.definitions.has(workforce_id)) {
      throw new Error(
        `WorkforceDefinition already registered: ${workforce_id}`
      );
    }

    for (const kind of LEGACY_REF_KINDS) {
      const value = legacy_refs[kind];
      if (value === undefined) {
        continue;
      }

      const existing = this.legacyIndexes[kind].get(value);
      if (existing && existing.size > 0) {
        throw new Error(
          `Legacy reference already registered: ${kind}=${value}`
        );
      }
    }

    const stored = cloneDefinition(parsed);
    this.definitions.set(workforce_id, stored);

    for (const kind of LEGACY_REF_KINDS) {
      const value = legacy_refs[kind];
      if (value === undefined) {
        continue;
      }

      let workforceIds = this.legacyIndexes[kind].get(value);
      if (!workforceIds) {
        workforceIds = new Set<string>();
        this.legacyIndexes[kind].set(value, workforceIds);
      }
      workforceIds.add(workforce_id);
    }

    return cloneDefinition(stored);
  }

  get(workforce_id: string): WorkforceDefinition | undefined {
    const stored = this.definitions.get(workforce_id);
    return stored === undefined ? undefined : cloneDefinition(stored);
  }

  list(): WorkforceDefinition[] {
    return Array.from(this.definitions.values(), cloneDefinition);
  }

  findByLegacyRef(
    kind: LegacyRefKind,
    value: string
  ): WorkforceDefinition[] {
    const workforceIds = this.legacyIndexes[kind].get(value);
    if (!workforceIds) {
      return [];
    }

    return Array.from(workforceIds, (workforceId) =>
      cloneDefinition(this.definitions.get(workforceId)!)
    );
  }
}
