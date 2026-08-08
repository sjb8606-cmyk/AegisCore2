/**
 * platform/aegis-swarm/src/employees/bookkeeper.ts
 *
 * E-05 — Bookkeeper.
 *
 * Real master: Luca Pacioli, the actual father of double-entry
 * bookkeeping (Summa de Arithmetica, 1494). His method isn't
 * referenced as philosophy — it's the literal, rigorous algorithm
 * this bot runs: every transaction's total debits must equal its
 * total credits exactly, or it isn't a valid transaction at all.
 * Verified against real accounting cases before implementation.
 *
 * validateTransaction() is the core Pacioli check. computeBalances()
 * applies standard normal-balance-side rules (assets/expenses
 * increase with debits; liabilities/equity/revenue increase with
 * credits — real, standard double-entry accounting, not invented).
 * checkAccountingEquation() is a genuine defensive audit: if every
 * transaction is individually balanced, Assets = Liabilities + Equity
 * should hold as a mathematical consequence — checking it separately
 * catches account-misclassification bugs that per-transaction
 * balancing alone wouldn't reveal.
 *
 * No LLM call needed for any of this — real, deterministic
 * bookkeeping math, fully testable on its own.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface LedgerEntry {
  account: string;
  accountType: AccountType;
  debit: number;
  credit: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  entries: LedgerEntry[];
}

export interface TransactionValidation {
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
}

const DEBIT_INCREASES: Set<AccountType> = new Set(['asset', 'expense']);
const BALANCE_TOLERANCE = 0.001;

export function validateTransaction(entries: LedgerEntry[]): TransactionValidation {
  const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);
  return {
    balanced: Math.abs(totalDebits - totalCredits) < BALANCE_TOLERANCE,
    totalDebits,
    totalCredits,
  };
}

export function computeBalances(transactions: Transaction[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const tx of transactions) {
    for (const entry of tx.entries) {
      if (!(entry.account in balances)) balances[entry.account] = 0;
      const sign = DEBIT_INCREASES.has(entry.accountType) ? 1 : -1;
      balances[entry.account] += sign * (entry.debit - entry.credit);
    }
  }
  return balances;
}

export interface EquationCheck {
  equationHolds: boolean;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
}

/**
 * Defensive audit — the real expanded accounting equation for an
 * unclosed ledger: Assets = Liabilities + Equity + Revenue - Expenses.
 * Revenue/expense only fold into Equity at period close (retained
 * earnings) — before that, they must be counted directly on the
 * right side or the equation never holds for a normal transaction
 * like "received cash for services." Fixed after a real test caught
 * the original version omitting revenue/expense entirely.
 */
export function checkAccountingEquation(
  balances: Record<string, number>,
  accountTypes: Record<string, AccountType>,
): EquationCheck {
  let totalAssets = 0;
  let totalLiabilitiesAndEquity = 0;
  for (const [account, balance] of Object.entries(balances)) {
    const type = accountTypes[account];
    if (type === 'asset') totalAssets += balance;
    else if (type === 'liability' || type === 'equity') totalLiabilitiesAndEquity += balance;
    else if (type === 'revenue') totalLiabilitiesAndEquity += balance;
    else if (type === 'expense') totalLiabilitiesAndEquity -= balance;
  }
  return {
    equationHolds: Math.abs(totalAssets - totalLiabilitiesAndEquity) < BALANCE_TOLERANCE,
    totalAssets,
    totalLiabilitiesAndEquity,
  };
}

export interface LedgerReport {
  validTransactionCount: number;
  invalidTransactions: Array<{ transaction: Transaction; validation: TransactionValidation }>;
  balances: Record<string, number>;
  equationCheck: EquationCheck;
}

export class BookkeeperBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async processLedger(transactions: Transaction[]): Promise<LedgerReport> {
    await this.enforcePermission('write:ledger');

    const invalidTransactions: LedgerReport['invalidTransactions'] = [];
    const validTransactions: Transaction[] = [];
    const accountTypes: Record<string, AccountType> = {};

    for (const tx of transactions) {
      const validation = validateTransaction(tx.entries);
      if (!validation.balanced) {
        invalidTransactions.push({ transaction: tx, validation });
        continue;
      }
      validTransactions.push(tx);
      for (const entry of tx.entries) {
        accountTypes[entry.account] = entry.accountType;
      }
    }

    const balances = computeBalances(validTransactions);
    const equationCheck = checkAccountingEquation(balances, accountTypes);

    const report: LedgerReport = {
      validTransactionCount: validTransactions.length,
      invalidTransactions,
      balances,
      equationCheck,
    };

    await this.createDecision(
      { transactionCount: transactions.length },
      {
        validCount: report.validTransactionCount,
        invalidCount: invalidTransactions.length,
        equationHolds: equationCheck.equationHolds,
      },
      'bookkeeper-ledger-v1',
    );

    if (invalidTransactions.length > 0 || !equationCheck.equationHolds) {
      await this.signalSwarm('employee.ledger_issue_found', {
        botId: this.botId,
        invalidCount: invalidTransactions.length,
        equationHolds: equationCheck.equationHolds,
      });
    }

    return report;
  }
}
