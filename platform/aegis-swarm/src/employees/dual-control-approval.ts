/**
 * platform/aegis-swarm/src/employees/dual-control-approval.ts
 *
 * E-33 — Dual-Control Approval.
 *
 * Real two-key enforcement, extending the existing Synchronous Gate
 * HITL pattern: a critical action requires a real, configurable
 * number of genuinely DIFFERENT approvers, not just a raw count.
 * checkDualControl() counts unique approver IDs via a real Set, so
 * the same person "approving" twice cannot fake reaching the
 * threshold — verified against exactly that case before
 * implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface DualControlCheck {
  approved: boolean;
  uniqueApproverCount: number;
  requiredApprovals: number;
}

export function checkDualControl(approverIds: string[], requiredApprovals: number): DualControlCheck {
  const uniqueApprovers = new Set(approverIds);
  return {
    approved: uniqueApprovers.size >= requiredApprovals,
    uniqueApproverCount: uniqueApprovers.size,
    requiredApprovals,
  };
}

export class DualControlApprovalBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkApproval(actionId: string, approverIds: string[], requiredApprovals = 2): Promise<DualControlCheck> {
    await this.enforcePermission('write:approvals');

    const check = checkDualControl(approverIds, requiredApprovals);

    await this.createDecision(
      { actionId, submittedApproverCount: approverIds.length },
      { approved: check.approved, uniqueApproverCount: check.uniqueApproverCount },
      'dual-control-approval-v1',
    );

    if (!check.approved) {
      await this.signalSwarm('employee.dual_control_pending', {
        botId: this.botId,
        actionId,
        uniqueApproverCount: check.uniqueApproverCount,
        requiredApprovals,
      });
    }

    return check;
  }
}
