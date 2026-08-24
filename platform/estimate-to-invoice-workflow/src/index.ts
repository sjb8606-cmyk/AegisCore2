import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultLaborRate: z.number().nonnegative().default(0)
});

const StatusSchema = z.enum([
  'estimated',
  'approved',
  'in_progress',
  'invoiced',
  'paid'
]);

export const EstimateInvoiceSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  estimateId: z.string().uuid(),
  laborHours: z.number().nonnegative(),
  laborRate: z.number().nonnegative(),
  partsCostTotal: z.number().nonnegative(),
  totalEstimate: z.number().nonnegative(),
  finalInvoiceAmount: z.number().nonnegative().nullable(),
  status: StatusSchema
});

export type EstimateInvoice = z.infer<
  typeof EstimateInvoiceSchema
>;

const workflowStore = new Map<
  string,
  EstimateInvoice
>();

/**
 * Injectable parts-cost dependency.
 * The real integration can be wired to
 * @platform/parts-inventory-usage without
 * creating a hard dependency on an unfinished
 * cross-core implementation.
 */
type PartsCostFn = (
  tenantId: string,
  jobId: string
) => Promise<number>;

let getPartsCostFn: PartsCostFn =
  async () => 0;

export function setPartsCostFn(
  fn: PartsCostFn
): void {
  getPartsCostFn = fn;
}

export function __resetEstimateInvoiceWorkflowStore(): void {
  workflowStore.clear();
  getPartsCostFn = async () => 0;
}

function getWorkflow(
  tenantId: string,
  jobId: string
): EstimateInvoice {
  const workflow = workflowStore.get(jobId);

  if (!workflow) {
    throw new AppError(
      'Estimate workflow not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (workflow.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return workflow;
}

export async function createEstimate(
  tenantId: string,
  actorId: string,
  jobId: string,
  laborHours: number,
  laborRate: number
): Promise<EstimateInvoice> {
  return runCrudOperation({
    configName: 'estimate-to-invoice-workflow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(jobId).success) {
        throw new AppError(
          'Invalid job ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(laborHours) || laborHours < 0) {
        throw new AppError(
          'Labor hours cannot be negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(laborRate) || laborRate < 0) {
        throw new AppError(
          'Labor rate cannot be negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (workflowStore.has(jobId)) {
        throw new AppError(
          'An estimate already exists for this job',
          ErrorCode.CONFLICT
        );
      }

      const totalEstimate =
        laborHours * laborRate;

      const workflow =
        EstimateInvoiceSchema.parse({
          jobId,
          tenantId,
          estimateId: crypto.randomUUID(),
          laborHours,
          laborRate,
          partsCostTotal: 0,
          totalEstimate,
          finalInvoiceAmount: null,
          status: 'estimated'
        });

      workflowStore.set(jobId, workflow);

      return workflow;
    },
    auditAction: 'data.created',
    auditResource: 'estimate_to_invoice_workflow',
    meterEventType: 'api_call'
  });
}

export async function approveEstimate(
  tenantId: string,
  actorId: string,
  estimateId: string
): Promise<EstimateInvoice> {
  return runCrudOperation({
    configName: 'estimate-to-invoice-workflow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const workflow =
        Array.from(workflowStore.values())
          .find(item =>
            item.estimateId === estimateId
          );

      if (!workflow) {
        throw new AppError(
          'Estimate not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (workflow.tenantId !== tenantId) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (workflow.status !== 'estimated') {
        throw new AppError(
          'Only estimated jobs can be approved',
          ErrorCode.CONFLICT
        );
      }

      workflow.status = 'approved';
      workflowStore.set(
        workflow.jobId,
        workflow
      );

      return workflow;
    },
    auditAction: 'data.updated',
    auditResource: 'estimate_to_invoice_workflow',
    meterEventType: 'api_call'
  });
}

export async function generateInvoice(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<EstimateInvoice> {
  return runCrudOperation({
    configName: 'estimate-to-invoice-workflow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const workflow = getWorkflow(
        tenantId,
        jobId
      );

      if (
        workflow.status !== 'approved' &&
        workflow.status !== 'in_progress'
      ) {
        throw new AppError(
          'Job must be approved or in progress before invoicing',
          ErrorCode.CONFLICT
        );
      }

      const partsCost =
        await getPartsCostFn(
          tenantId,
          jobId
        );

      if (
        !Number.isFinite(partsCost) ||
        partsCost < 0
      ) {
        throw new AppError(
          'Invalid parts cost',
          ErrorCode.BAD_REQUEST
        );
      }

      workflow.partsCostTotal = partsCost;
      workflow.finalInvoiceAmount =
        workflow.laborHours *
          workflow.laborRate +
        partsCost;
      workflow.status = 'invoiced';

      workflowStore.set(
        workflow.jobId,
        workflow
      );

      return workflow;
    },
    auditAction: 'data.updated',
    auditResource: 'estimate_to_invoice_workflow',
    meterEventType: 'api_call'
  });
}

export async function markPaid(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<EstimateInvoice> {
  return runCrudOperation({
    configName: 'estimate-to-invoice-workflow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const workflow = getWorkflow(
        tenantId,
        jobId
      );

      if (
        workflow.status !== 'invoiced'
      ) {
        throw new AppError(
          'Only invoiced jobs can be marked paid',
          ErrorCode.CONFLICT
        );
      }

      workflow.status = 'paid';

      workflowStore.set(
        workflow.jobId,
        workflow
      );

      return workflow;
    },
    auditAction: 'data.updated',
    auditResource: 'estimate_to_invoice_workflow',
    meterEventType: 'api_call'
  });
}
