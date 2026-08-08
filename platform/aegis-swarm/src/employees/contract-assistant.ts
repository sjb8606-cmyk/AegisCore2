/**
 * platform/aegis-swarm/src/employees/contract-assistant.ts
 *
 * E-13 — Contract Assistant.
 *
 * Real clause-presence checking, same discipline as E-04's real
 * reference verification — genuine pattern matching against real
 * text, not fabricated legal advice. Flags which required clauses
 * are present or missing; never interprets legal meaning or gives
 * legal advice beyond that factual presence check. Verified against
 * a real full-coverage case and a real missing-clause case before
 * implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface RequiredClause {
  name: string;
  patterns: string[];
}

export interface ClauseCheckResult {
  clause: string;
  found: boolean;
}

export function checkClauses(contractText: string, requiredClauses: RequiredClause[]): ClauseCheckResult[] {
  const lower = contractText.toLowerCase();
  return requiredClauses.map((c) => ({
    clause: c.name,
    found: c.patterns.some((p) => lower.includes(p.toLowerCase())),
  }));
}

export interface ContractReport {
  results: ClauseCheckResult[];
  missingClauses: string[];
  complete: boolean;
}

export class ContractAssistantBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async reviewContract(contractText: string, requiredClauses: RequiredClause[]): Promise<ContractReport> {
    await this.enforcePermission('read:contract-text');

    const results = checkClauses(contractText, requiredClauses);
    const missingClauses = results.filter((r) => !r.found).map((r) => r.clause);
    const report: ContractReport = { results, missingClauses, complete: missingClauses.length === 0 };

    await this.createDecision(
      { clauseCount: requiredClauses.length },
      { missingCount: missingClauses.length },
      'contract-assistant-v1',
    );

    if (missingClauses.length > 0) {
      await this.signalSwarm('employee.missing_contract_clauses', { botId: this.botId, missingClauses });
    }

    return report;
  }
}
