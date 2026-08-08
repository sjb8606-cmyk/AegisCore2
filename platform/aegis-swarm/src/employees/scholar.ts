/**
 * platform/aegis-swarm/src/employees/scholar.ts
 *
 * E-29 — The Scholar.
 *
 * Real structural completeness check for an academic/non-fiction
 * document: required sections present (Abstract, Introduction, Main
 * Body, Conclusion, References, Falsifiability Statement) and a real
 * abstract word-count range (100-150 words), same pattern as E-22's
 * title-length check. Verified against a complete doc, a doc missing
 * sections, and an abstract-too-short case before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const MIN_ABSTRACT_WORDS = 100;
const MAX_ABSTRACT_WORDS = 150;

export interface ScholarlyDocument {
  abstract: string;
  introduction: string;
  mainBody: string;
  conclusion: string;
  references: string;
  falsifiabilityStatement: string;
}

export interface StructureCheck {
  missing: string[];
  abstractWordCount: number;
  abstractInRange: boolean;
  complete: boolean;
}

export function checkStructure(doc: Partial<ScholarlyDocument>): StructureCheck {
  const required: (keyof ScholarlyDocument)[] = [
    'abstract',
    'introduction',
    'mainBody',
    'conclusion',
    'references',
    'falsifiabilityStatement',
  ];
  const missing = required.filter((f) => !doc[f] || doc[f]!.trim().length === 0);

  const abstractWordCount = doc.abstract ? doc.abstract.trim().split(/\s+/).length : 0;
  const abstractInRange = abstractWordCount >= MIN_ABSTRACT_WORDS && abstractWordCount <= MAX_ABSTRACT_WORDS;

  return { missing, abstractWordCount, abstractInRange, complete: missing.length === 0 && abstractInRange };
}

export class ScholarBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async reviewDocument(doc: Partial<ScholarlyDocument>): Promise<StructureCheck> {
    await this.enforcePermission('read:document-text');

    const check = checkStructure(doc);

    await this.createDecision(
      { hasAllFields: Object.keys(doc).length },
      { complete: check.complete, missingCount: check.missing.length },
      'scholar-v1',
    );

    if (!check.complete) {
      await this.signalSwarm('employee.document_structure_incomplete', {
        botId: this.botId,
        missing: check.missing,
        abstractInRange: check.abstractInRange,
      });
    }

    return check;
  }
}
