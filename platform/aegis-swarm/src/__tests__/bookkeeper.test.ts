import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  BookkeeperBot,
  validateTransaction,
  computeBalances,
  checkAccountingEquation,
  Transaction,
  LedgerEntry,
} from '../employees/bookkeeper';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-05',
    role: 'Test Bookkeeper used to verify Pacioli double-entry validation and balance computation.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Bookkeeper used to verify real double-entry accounting logic.',
    permissionScope: ['write:ledger'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const CASH_IN: LedgerEntry = { account: 'Cash', accountType: 'asset', debit: 500, credit: 0 };
const REVENUE: LedgerEntry = { account: 'Service Revenue', accountType: 'revenue', debit: 0, credit: 500 };
const RENT_EXPENSE: LedgerEntry = { account: 'Rent Expense', accountType: 'expense', debit: 200, credit: 0 };
const CASH_OUT: LedgerEntry = { account: 'Cash', accountType: 'asset', debit: 0, credit: 200 };

describe('validateTransaction (pure Pacioli double-entry rule)', () => {
  it('confirms a genuinely balanced transaction', () => {
    const result = validateTransaction([CASH_IN, REVENUE]);
    expect(result.balanced).toBe(true);
  });

  it('flags a genuinely unbalanced transaction', () => {
    const result = validateTransaction([CASH_IN, { ...REVENUE, credit: 400 }]);
    expect(result.balanced).toBe(false);
    expect(result.totalDebits).toBe(500);
    expect(result.totalCredits).toBe(400);
  });
});

describe('computeBalances (real running balance computation)', () => {
  it('computes correct balances across multiple real transactions', () => {
    const transactions: Transaction[] = [
      { id: '1', date: '2026-01-01', description: 'Services rendered', entries: [CASH_IN, REVENUE] },
      { id: '2', date: '2026-01-02', description: 'Paid rent', entries: [RENT_EXPENSE, CASH_OUT] },
    ];
    const balances = computeBalances(transactions);

    expect(balances['Cash']).toBe(300);
    expect(balances['Service Revenue']).toBe(500);
    expect(balances['Rent Expense']).toBe(200);
  });
});

describe('checkAccountingEquation (defensive audit)', () => {
  it('holds when balances and account types are consistent', () => {
    const balances = { Cash: 300, Loan: 100, Equity: 200 };
    const accountTypes: Record<string, any> = { Cash: 'asset', Loan: 'liability', Equity: 'equity' };
    const result = checkAccountingEquation(balances, accountTypes);
    expect(result.equationHolds).toBe(true);
  });

  it('does not hold when assets and liabilities+equity genuinely disagree', () => {
    const balances = { Cash: 500, Loan: 100, Equity: 200 };
    const accountTypes: Record<string, any> = { Cash: 'asset', Loan: 'liability', Equity: 'equity' };
    const result = checkAccountingEquation(balances, accountTypes);
    expect(result.equationHolds).toBe(false);
  });
});

describe('BookkeeperBot', () => {
  describe('processLedger', () => {
    it('processes a real, fully-balanced ledger correctly', async () => {
      const bot = new BookkeeperBot(makeSpec());
      const transactions: Transaction[] = [
        { id: '1', date: '2026-01-01', description: 'Services rendered', entries: [CASH_IN, REVENUE] },
        { id: '2', date: '2026-01-02', description: 'Paid rent', entries: [RENT_EXPENSE, CASH_OUT] },
      ];

      const report = await bot.processLedger(transactions);

      expect(report.validTransactionCount).toBe(2);
      expect(report.invalidTransactions).toHaveLength(0);
      expect(report.balances['Cash']).toBe(300);
    });

    it('excludes an unbalanced transaction from balances and reports it separately', async () => {
      const bot = new BookkeeperBot(makeSpec());
      const badTx: Transaction = {
        id: 'bad',
        date: '2026-01-03',
        description: 'A genuine bookkeeping error',
        entries: [CASH_IN, { ...REVENUE, credit: 400 }],
      };

      const report = await bot.processLedger([badTx]);

      expect(report.validTransactionCount).toBe(0);
      expect(report.invalidTransactions).toHaveLength(1);
      expect(report.balances['Cash']).toBeUndefined();
    });

    it('signals the swarm when an invalid transaction exists', async () => {
      const bot = new BookkeeperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.processLedger([
        { id: 'bad', date: '2026-01-03', description: 'bad', entries: [CASH_IN, { ...REVENUE, credit: 400 }] },
      ]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when the ledger is fully valid and balanced', async () => {
      const bot = new BookkeeperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.processLedger([{ id: '1', date: '2026-01-01', description: 'ok', entries: [CASH_IN, REVENUE] }]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks processing without write:ledger permission', async () => {
      const bot = new BookkeeperBot(makeSpec({ permissionScope: [] }));
      await expect(bot.processLedger([])).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
