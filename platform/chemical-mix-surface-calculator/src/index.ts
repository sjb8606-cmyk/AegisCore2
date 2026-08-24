import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  coverageGallonsPer100SqFt: z.number().positive().default(1),
  defaultDilutionRatios: z.record(z.string()).default({})
});

const CalculationSchema = z.object({
  calculationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  propertyId: z.string().uuid(),
  surfaceType: z.enum([
    'concrete',
    'vinyl_siding',
    'wood_deck',
    'roof',
    'brick'
  ]),
  chemicalType: z.string().min(1).max(100),
  dilutionRatio: z.string().min(1).max(100),
  areaSqft: z.number().positive(),
  estimatedChemicalNeededGallons: z.number().positive(),
  createdAt: z.string().datetime()
});

export type Calculation = z.infer<
  typeof CalculationSchema
>;

const calculationStore =
  new Map<string, Calculation>();

const dilutionDefaults: Record<
  Calculation['surfaceType'],
  string
> = {
  concrete: '1:10',
  vinyl_siding: '1:20',
  wood_deck: '1:30',
  roof: '1:10',
  brick: '1:15'
};

export function __resetChemicalMixSurfaceCalculatorStore(): void {
  calculationStore.clear();
}

function parseArea(areaSqft: number): number {
  if (
    !Number.isFinite(areaSqft) ||
    areaSqft <= 0
  ) {
    throw new AppError(
      'Area must be greater than zero',
      ErrorCode.BAD_REQUEST
    );
  }

  return areaSqft;
}

export function calculateChemicalNeeded(
  areaSqft: number,
  coverageGallonsPer100SqFt: number
): number {
  parseArea(areaSqft);

  if (
    !Number.isFinite(
      coverageGallonsPer100SqFt
    ) ||
    coverageGallonsPer100SqFt <= 0
  ) {
    throw new AppError(
      'Coverage rate must be greater than zero',
      ErrorCode.BAD_REQUEST
    );
  }

  return (
    areaSqft / 100
  ) * coverageGallonsPer100SqFt;
}

export async function calculateDilution(
  tenantId: string,
  actorId: string,
  propertyId: string,
  surfaceType: Calculation['surfaceType'],
  chemicalType: string,
  areaSqft: number
): Promise<Calculation> {
  return runCrudOperation({
    configName: 'chemical-mix-surface-calculator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!propertyId.trim()) {
        throw new AppError(
          'Property ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!chemicalType.trim()) {
        throw new AppError(
          'Chemical type is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const area = parseArea(areaSqft);
      const config = ConfigSchema.parse({});

      const estimatedChemicalNeededGallons =
        calculateChemicalNeeded(
          area,
          config.coverageGallonsPer100SqFt
        );

      const calculation =
        CalculationSchema.parse({
          calculationId: crypto.randomUUID(),
          tenantId,
          propertyId,
          surfaceType,
          chemicalType: chemicalType.trim(),
          dilutionRatio:
            dilutionDefaults[surfaceType],
          areaSqft: area,
          estimatedChemicalNeededGallons,
          createdAt: new Date().toISOString()
        });

      calculationStore.set(
        calculation.calculationId,
        calculation
      );

      return calculation;
    },
    auditAction: 'data.created',
    auditResource: 'chemical_mix_surface_calculation',
    meterEventType: 'api_call'
  });
}

export async function getAreaFromPropertyMeasurement(
  tenantId: string,
  actorId: string,
  propertyId: string
): Promise<number> {
  return runCrudOperation({
    configName: 'chemical-mix-surface-calculator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!propertyId.trim()) {
        throw new AppError(
          'Property ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      throw new AppError(
        'Property measurement integration is not configured',
        ErrorCode.NOT_FOUND
      );
    },
    auditAction: 'data.read',
    auditResource: 'property_measurement',
    meterEventType: 'api_call'
  });
}

export async function estimateChemicalCost(
  tenantId: string,
  actorId: string,
  calculationId: string,
  pricePerGallon: number
): Promise<number> {
  return runCrudOperation({
    configName: 'chemical-mix-surface-calculator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(pricePerGallon) ||
        pricePerGallon < 0
      ) {
        throw new AppError(
          'Price per gallon must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const calculation =
        calculationStore.get(
          calculationId
        );

      if (!calculation) {
        throw new AppError(
          'Calculation not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (
        calculation.tenantId !== tenantId
      ) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      return (
        calculation.estimatedChemicalNeededGallons *
        pricePerGallon
      );
    },
    auditAction: 'data.read',
    auditResource: 'chemical_mix_surface_calculation',
    meterEventType: 'api_call'
  });
}
