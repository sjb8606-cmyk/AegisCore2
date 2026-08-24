import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  currentCodeVersion: z.string().min(1).default('2024')
});

const CircuitSchema = z.object({
  circuitNumber: z.number().int().positive(),
  breakerAmperage: z.number().int().positive(),
  labeledUse: z.string().min(1).max(500),
  lastInspectedDate: z.coerce.date().nullable()
});

const PanelSchema = z.object({
  panelId: z.string().uuid(),
  tenantId: z.string().uuid(),
  propertyId: z.string().uuid(),
  panelAmperage: z.number().int().positive(),
  codeComplianceVersion: z.string().min(1).max(100),
  circuits: z.array(CircuitSchema)
});

export type Circuit = z.infer<typeof CircuitSchema>;
export type ElectricalPanel = z.infer<typeof PanelSchema>;

const panelStore = new Map<string, ElectricalPanel>();

export function __resetElectricalPanelCircuitInventoryStore(): void {
  panelStore.clear();
}

function getPanel(
  tenantId: string,
  panelId: string
): ElectricalPanel {
  const panel = panelStore.get(panelId);

  if (!panel) {
    throw new AppError(
      'Electrical panel not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (panel.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return panel;
}

export async function registerPanel(
  tenantId: string,
  actorId: string,
  propertyId: string,
  panelAmperage: number,
  codeVersion: string
): Promise<ElectricalPanel> {
  return runCrudOperation({
    configName: 'electrical-panel-circuit-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(propertyId).success) {
        throw new AppError(
          'Invalid property ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isInteger(panelAmperage) || panelAmperage <= 0) {
        throw new AppError(
          'Panel amperage must be a positive integer',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!codeVersion.trim()) {
        throw new AppError(
          'Code compliance version is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const panel = PanelSchema.parse({
        panelId: crypto.randomUUID(),
        tenantId,
        propertyId,
        panelAmperage,
        codeComplianceVersion: codeVersion.trim(),
        circuits: []
      });

      panelStore.set(panel.panelId, panel);

      return panel;
    },
    auditAction: 'data.created',
    auditResource: 'electrical_panel',
    meterEventType: 'api_call'
  });
}

export async function addCircuit(
  tenantId: string,
  actorId: string,
  panelId: string,
  circuitData: Circuit
): Promise<ElectricalPanel> {
  return runCrudOperation({
    configName: 'electrical-panel-circuit-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const panel = getPanel(tenantId, panelId);
      const circuit = CircuitSchema.parse(circuitData);

      if (
        panel.circuits.some(
          item =>
            item.circuitNumber === circuit.circuitNumber
        )
      ) {
        throw new AppError(
          'Circuit number already exists on this panel',
          ErrorCode.CONFLICT
        );
      }

      panel.circuits.push(circuit);
      panelStore.set(panel.panelId, panel);

      return panel;
    },
    auditAction: 'data.updated',
    auditResource: 'electrical_panel',
    meterEventType: 'api_call'
  });
}

export async function flagOutdatedCodeCompliance(
  tenantId: string,
  actorId: string,
  panelId: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'electrical-panel-circuit-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const panel = getPanel(tenantId, panelId);

      return (
        panel.codeComplianceVersion !==
        ConfigSchema.parse({}).currentCodeVersion
      );
    },
    auditAction: 'data.read',
    auditResource: 'electrical_panel',
    meterEventType: 'api_call'
  });
}
