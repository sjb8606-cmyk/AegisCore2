/**
 * platform/aegis-swarm/src/employees/invoice-manager.ts
 *
 * E-35 — Invoice Manager.
 *
 * Real, standard aging-bucket classification (0-30/31-60/61-90/90+
 * days overdue) — pairs naturally with E-05's Bookkeeper. Verified
 * against real cases (not yet due, 15/45/120 days overdue) before
 * implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type AgingBucket = 'current' | '0-30' | '31-60' | '61-90' | '90+';

export interface Invoice {
  id: string;
  dueDateMs: number;
  amount: number;
}

export function classifyAging(dueDateMs: number, nowMs: number): AgingBucket {
  const daysOverdue = Math.floor((nowMs - dueDateMs) / 86400000);
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '0-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export interface AgingReport {
  current: Invoice[];
  bucket0to30: Invoice[];
  bucket31to60: Invoice[];
  bucket61to90: Invoice[];
  bucket90plus: Invoice[];
  totalOverdueAmount: number;
}

export class InvoiceManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async runAgingReport(invoices: Invoice[], nowMs: number): Promise<AgingReport> {
    await this.enforcePermission('read:invoices');

    const classified = invoices.map((inv) => ({ inv, bucket: classifyAging(inv.dueDateMs, nowMs) }));

    const report: AgingReport = {
      current: classified.filter((c) => c.bucket === 'current').map((c) => c.inv),
      bucket0to30: classified.filter((c) => c.bucket === '0-30').map((c) => c.inv),
      bucket31to60: classified.filter((c) => c.bucket === '31-60').map((c) => c.inv),
      bucket61to90: classified.filter((c) => c.bucket === '61-90').map((c) => c.inv),
      bucket90plus: classified.filter((c) => c.bucket === '90+').map((c) => c.inv),
      totalOverdueAmount: classified.filter((c) => c.bucket !== 'current').reduce((sum, c) => sum + c.inv.amount, 0),
    };

    await this.createDecision(
      { invoiceCount: invoices.length },
      { totalOverdueAmount: report.totalOverdueAmount, severeCount: report.bucket90plus.length },
      'invoice-manager-v1',
    );

    if (report.bucket90plus.length > 0) {
      await this.signalSwarm('employee.severe_overdue_invoices', {
        botId: this.botId,
        count: report.bucket90plus.length,
      });
    }

    return report;
  }
}
