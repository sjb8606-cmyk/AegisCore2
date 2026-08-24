import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultWeatherSource: z.string().default('configured')
});

const TriggerSchema = z.object({
  triggerId: z.string().uuid(),
  tenantId: z.string().uuid(),
  propertyId: z.string().uuid(),
  accumulationThresholdInches: z.number().nonnegative(),
  currentAccumulation: z.number().nonnegative(),
  weatherSource: z.string().min(1),
  triggered: z.boolean(),
  triggeredAt: z.string().datetime().nullable()
});

export type WeatherTrigger = z.infer<typeof TriggerSchema>;

const triggerStore = new Map<string, WeatherTrigger>();

export function __resetWeatherTriggeredDispatchStore(): void {
  triggerStore.clear();
}

export async function createTrigger(
  tenantId: string,
  actorId: string,
  propertyId: string,
  accumulationThresholdInches: number,
  weatherSource: string = 'configured'
): Promise<WeatherTrigger> {
  return runCrudOperation({
    configName: 'weather-triggered-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(accumulationThresholdInches) ||
        accumulationThresholdInches < 0
      ) {
        throw new AppError(
          'Accumulation threshold must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!weatherSource.trim()) {
        throw new AppError(
          'Weather source is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const trigger = TriggerSchema.parse({
        triggerId: crypto.randomUUID(),
        tenantId,
        propertyId,
        accumulationThresholdInches,
        currentAccumulation: 0,
        weatherSource: weatherSource.trim(),
        triggered: false,
        triggeredAt: null
      });

      triggerStore.set(trigger.triggerId, trigger);
      return trigger;
    },
    auditAction: 'data.created',
    auditResource: 'weather_trigger',
    meterEventType: 'api_call'
  });
}

export async function checkThreshold(
  tenantId: string,
  actorId: string,
  propertyId: string,
  currentAccumulation: number
): Promise<boolean> {
  return runCrudOperation({
    configName: 'weather-triggered-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!Number.isFinite(currentAccumulation) || currentAccumulation < 0) {
        throw new AppError(
          'Current accumulation must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const trigger = Array.from(triggerStore.values()).find(
        (item) =>
          item.tenantId === tenantId &&
          item.propertyId === propertyId
      );

      if (!trigger) {
        throw new AppError(
          'Weather trigger not found',
          ErrorCode.NOT_FOUND
        );
      }

      return currentAccumulation >=
        trigger.accumulationThresholdInches;
    },
    auditAction: 'data.read',
    auditResource: 'weather_trigger',
    meterEventType: 'api_call'
  });
}

export async function triggerDispatch(
  tenantId: string,
  actorId: string,
  triggerId: string
): Promise<WeatherTrigger> {
  return runCrudOperation({
    configName: 'weather-triggered-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const trigger = triggerStore.get(triggerId);

      if (!trigger) {
        throw new AppError(
          'Weather trigger not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (trigger.tenantId !== tenantId) {
        throw new AppError(
          'Weather trigger does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (trigger.currentAccumulation <
          trigger.accumulationThresholdInches) {
        throw new AppError(
          'Accumulation threshold has not been reached',
          ErrorCode.CONFLICT
        );
      }

      const updated = TriggerSchema.parse({
        ...trigger,
        triggered: true,
        triggeredAt: new Date().toISOString()
      });

      triggerStore.set(triggerId, updated);
      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'weather_trigger_dispatch',
    meterEventType: 'api_call'
  });
}

export async function updateAccumulation(
  tenantId: string,
  actorId: string,
  triggerId: string,
  currentAccumulation: number
): Promise<WeatherTrigger> {
  return runCrudOperation({
    configName: 'weather-triggered-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const trigger = triggerStore.get(triggerId);

      if (!trigger) {
        throw new AppError(
          'Weather trigger not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (trigger.tenantId !== tenantId) {
        throw new AppError(
          'Weather trigger does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (!Number.isFinite(currentAccumulation) || currentAccumulation < 0) {
        throw new AppError(
          'Current accumulation must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const updated = TriggerSchema.parse({
        ...trigger,
        currentAccumulation
      });

      triggerStore.set(triggerId, updated);
      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'weather_trigger',
    meterEventType: 'api_call'
  });
}
