import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'fintech.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { accountCount: 20 } };
}

export async function createAccount(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Fintech vertical disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM ledger_accounts WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.accountCount) {
    throw new AppError('Ledger account limits reached', ErrorCode.FORBIDDEN);
  }

  const accountId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO ledger_accounts (id, tenant_id, code, name, type)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [accountId, tenantId, data.code, data.name, data.type], tenantId);
  return res[0];
}

async function generateEntryNumber(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const res = await withTenantQuery(`SELECT COUNT(*) as seq FROM journal_entries WHERE tenant_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`, [tenantId, year], tenantId);
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(5, '0');
  return `JE-${year}-${seq}`;
}

function validateDoubleEntry(lines: any[]): boolean {
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.type === 'debit') debits += BigInt(line.amountCents);
    else credits += BigInt(line.amountCents);
  }
  return debits === credits;
}

export async function createJournalEntry(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Fintech vertical disabled', ErrorCode.FORBIDDEN);

  if (!validateDoubleEntry(data.lines)) {
    throw new AppError('Balanced ledger compliance check failed: debits must equal credits', ErrorCode.BAD_REQUEST);
  }

  const cleanUserId = parseUserId(userId);
  const entryNumber = await generateEntryNumber(tenantId);
  const entryId = crypto.randomUUID();

  // 1. Insert Journal Entry Header
  const insertEntry = `
    INSERT INTO journal_entries (id, tenant_id, entry_number, description, reference, created_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const entryResult = await withTenantQuery(insertEntry, [
    entryId, tenantId, entryNumber, data.description, data.reference || null, cleanUserId
  ], tenantId);

  // 2. Process Lines & Atomic Balance Updates with Row-Level Locking
  for (const line of data.lines) {
    // Lock Account Row
    const acctRes = await withTenantQuery('SELECT type, balance_cents FROM ledger_accounts WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [line.accountId, tenantId], tenantId);
    const acct = acctRes[0];
    if (!acct) throw new AppError('Ledger account not found', ErrorCode.NOT_FOUND);

    let diff = BigInt(line.amountCents);
    const isNormalDebit = acct.type === 'asset' || acct.type === 'expense';

    if (line.type === 'debit') {
      diff = isNormalDebit ? diff : -diff;
    } else {
      diff = isNormalDebit ? -diff : diff;
    }

    // Apply balance update
    await withTenantQuery('UPDATE ledger_accounts SET balance_cents = balance_cents + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3', [diff.toString(), line.accountId, tenantId], tenantId);

    // Insert Line
    const lineId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO journal_lines (id, tenant_id, entry_id, account_id, type, amount_cents, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `, [lineId, tenantId, entryId, line.accountId, line.type, line.amountCents, line.description || null], tenantId);
  }

  return entryResult[0];
}

export async function voidJournalEntry(tenantId: string, entryId: string, reason: string, userId: string) {
  const cleanUserId = parseUserId(userId);

  // 1. Get original posted entry
  const originalRes = await withTenantQuery('SELECT status FROM journal_entries WHERE id = $1 AND tenant_id = $2', [entryId, tenantId], tenantId);
  const original = originalRes[0];
  if (!original) throw new AppError('Journal Entry not found', ErrorCode.NOT_FOUND);
  if (original.status !== 'posted') throw new AppError('Only posted journal entries can be voided', ErrorCode.BAD_REQUEST);

  // 2. Fetch original lines
  const lines = await withTenantQuery('SELECT * FROM journal_lines WHERE entry_id = $1 AND tenant_id = $2', [entryId, tenantId], tenantId);

  // 3. Construct Reversing Entry lines
  const reversingLines = lines.map((line: any) => ({
    accountId: line.account_id,
    type: line.type === 'debit' ? 'credit' : 'debit',
    amountCents: parseInt(line.amount_cents, 10),
    description: `Reversal: ${line.description || 'Void entry'}`
  }));

  // 4. Create Reversing Entry Header & update balances
  const reversalEntry = await createJournalEntry(tenantId, cleanUserId, {
    description: `Void JE: Reversing entry for ${entryId}. Reason: ${reason}`,
    reference: entryId,
    lines: reversingLines
  });

  // 5. Update original entry status to voided
  await withTenantQuery(`
    UPDATE journal_entries 
    SET status = 'voided', voided_at = CURRENT_TIMESTAMP, void_reason = $1 
    WHERE id = $2 AND tenant_id = $3;
  `, [reason, entryId, tenantId], tenantId);

  return reversalEntry;
}

export async function getLedgerAccount(tenantId: string, accountId: string) {
  const res = await withTenantQuery('SELECT * FROM ledger_accounts WHERE id = $1 AND tenant_id = $2', [accountId, tenantId], tenantId);
  return res[0];
}
