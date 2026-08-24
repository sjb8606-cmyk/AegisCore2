import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const VehicleTypeSchema = z.enum([
  'sedan',
  'suv',
  'motorcycle',
  'heavy_truck',
  'exotic'
]);

const SituationSchema = z.enum([
  'flat_tire',
  'accident',
  'off_road_recovery',
  'standard_tow'
]);

const TruckTypeSchema = z.enum([
  'flatbed',
  'wheel_lift',
  'heavy_duty',
  'motorcycle_trailer'
]);

const MatchSchema = z.object({
  matchId: z.string().uuid(),
  tenantId: z.string().uuid(),
  vehicleType: VehicleTypeSchema,
  situation: SituationSchema,
  requiredTruckType: TruckTypeSchema,
  location: z.string().min(1).max(500),
  createdAt: z.string().datetime()
});

export type VehicleType = z.infer<typeof VehicleTypeSchema>;
export type Situation = z.infer<typeof SituationSchema>;
export type TruckType = z.infer<typeof TruckTypeSchema>;
export type TruckMatch = z.infer<typeof MatchSchema>;

const matchStore = new Map<string, TruckMatch>();

const truckMatrix: Record<
  VehicleType,
  Record<Situation, TruckType>
> = {
  sedan: {
    flat_tire: 'wheel_lift',
    accident: 'flatbed',
    off_road_recovery: 'flatbed',
    standard_tow: 'wheel_lift'
  },
  suv: {
    flat_tire: 'wheel_lift',
    accident: 'flatbed',
    off_road_recovery: 'flatbed',
    standard_tow: 'wheel_lift'
  },
  motorcycle: {
    flat_tire: 'motorcycle_trailer',
    accident: 'motorcycle_trailer',
    off_road_recovery: 'motorcycle_trailer',
    standard_tow: 'motorcycle_trailer'
  },
  heavy_truck: {
    flat_tire: 'heavy_duty',
    accident: 'heavy_duty',
    off_road_recovery: 'heavy_duty',
    standard_tow: 'heavy_duty'
  },
  exotic: {
    flat_tire: 'flatbed',
    accident: 'flatbed',
    off_road_recovery: 'flatbed',
    standard_tow: 'flatbed'
  }
};

export function __resetTowTruckTypeMatchingStore(): void {
  matchStore.clear();
}

export function determineTruckType(
  vehicleType: VehicleType,
  situation: Situation
): TruckType {
  return truckMatrix[vehicleType][situation];
}

export async function createTruckMatch(
  tenantId: string,
  actorId: string,
  vehicleType: VehicleType,
  situation: Situation,
  location: string
): Promise<TruckMatch> {
  return runCrudOperation({
    configName: 'tow-truck-type-matching',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!location.trim()) {
        throw new AppError(
          'Location is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const requiredTruckType =
        determineTruckType(
          vehicleType,
          situation
        );

      const match = MatchSchema.parse({
        matchId: crypto.randomUUID(),
        tenantId,
        vehicleType,
        situation,
        requiredTruckType,
        location: location.trim(),
        createdAt: new Date().toISOString()
      });

      matchStore.set(
        match.matchId,
        match
      );

      return match;
    },
    auditAction: 'data.created',
    auditResource: 'tow_truck_type_match',
    meterEventType: 'api_call'
  });
}

export async function findAvailableTruck(
  tenantId: string,
  actorId: string,
  requiredTruckType: TruckType,
  location: string
): Promise<{
  requiredTruckType: TruckType;
  location: string;
  available: boolean;
}> {
  return runCrudOperation({
    configName: 'tow-truck-type-matching',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!location.trim()) {
        throw new AppError(
          'Location is required',
          ErrorCode.BAD_REQUEST
        );
      }

      return {
        requiredTruckType,
        location: location.trim(),
        available: true
      };
    },
    auditAction: 'data.read',
    auditResource: 'tow_truck_type_match',
    meterEventType: 'api_call'
  });
}
