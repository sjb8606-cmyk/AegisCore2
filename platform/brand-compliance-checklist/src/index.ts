import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('brand-compliance-checklist');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const ChecklistItemSchema = z.object({
  item: z.string().min(1),
  compliant: z.boolean(),
  notes: z.string().optional(),
  photo: z.string().optional()
});

export const ChecklistItemsSchema =
  z.array(ChecklistItemSchema);

export type ChecklistItem =
  z.infer<typeof ChecklistItemSchema>;

export interface ComplianceChecklist {
  checklist_id: string;
  tenant_id: string;
  location_id: string;
  checklist_template_id: string;
  items: ChecklistItem[];
  overall_score: number;
  audit_date: string;
  auditor_id: string;
  created_at: string;
  updated_at: string;
}

const checklistStore =
  new Map<string, ComplianceChecklist>();

export function __resetBrandComplianceChecklistStore(): void {
  checklistStore.clear();
}

function getConfig() {
  return loadConfig(
    'brand-compliance-checklist',
    ConfigSchema
  );
}

function calculateScore(
  items: ChecklistItem[]
): number {
  if (items.length === 0) {
    return 0;
  }

  const compliant = items.filter(
    (item) => item.compliant
  ).length;

  return Math.round(
    (compliant / items.length) * 100
  );
}

export async function assignChecklist(
  tenantId: string,
  actorId: string,
  locationId: string,
  templateId: string
): Promise<ComplianceChecklist> {
  return runCrudOperation({
    configName: 'brand-compliance-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Brand compliance checklist is disabled'
        );
      }

      if (!locationId.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Location ID is required'
        );
      }

      if (!templateId.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Checklist template ID is required'
        );
      }

      const now = new Date().toISOString();

      const record: ComplianceChecklist = {
        checklist_id: crypto.randomUUID(),
        tenant_id: tenantId,
        location_id: locationId,
        checklist_template_id: templateId,
        items: [],
        overall_score: 0,
        audit_date: now,
        auditor_id: actorId,
        created_at: now,
        updated_at: now
      };

      checklistStore.set(
        record.checklist_id,
        record
      );

      logger.info('Compliance checklist assigned', {
        tenantId,
        locationId,
        checklistId: record.checklist_id
      });

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'brand_compliance_checklist',
    meterEventType: 'api_call'
  });
}

export async function submitAudit(
  tenantId: string,
  actorId: string,
  checklistId: string,
  items: ChecklistItem[]
): Promise<ComplianceChecklist> {
  return runCrudOperation({
    configName: 'brand-compliance-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        checklistStore.get(checklistId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Compliance checklist not found'
        );
      }

      const parsed =
        ChecklistItemsSchema.safeParse(items);

      if (!parsed.success) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Invalid compliance checklist items'
        );
      }

      const updated: ComplianceChecklist = {
        ...record,
        items: parsed.data,
        overall_score:
          calculateScore(parsed.data),
        audit_date:
          new Date().toISOString(),
        auditor_id: actorId,
        updated_at:
          new Date().toISOString()
      };

      checklistStore.set(
        checklistId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'brand_compliance_checklist',
    meterEventType: 'api_call'
  });
}

export async function getComplianceHistory(
  tenantId: string,
  actorId: string,
  locationId: string
): Promise<ComplianceChecklist[]> {
  return runCrudOperation({
    configName: 'brand-compliance-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      return Array.from(
        checklistStore.values()
      ).filter(
        (record) =>
          record.tenant_id === tenantId &&
          record.location_id === locationId
      );
    },
    auditAction: 'data.read',
    auditResource: 'brand_compliance_checklist',
    meterEventType: 'api_call'
  });
}

export function getChecklist(
  tenantId: string,
  checklistId: string
): ComplianceChecklist | undefined {
  const record =
    checklistStore.get(checklistId);

  if (
    !record ||
    record.tenant_id !== tenantId
  ) {
    return undefined;
  }

  return record;
}
