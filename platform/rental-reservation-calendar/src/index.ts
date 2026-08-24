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

const ReservationSchema = z.object({
  reservationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  assetId: z.string().uuid(),
  clientId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  bufferHoursAfter: z.number().nonnegative(),
  status: z.enum([
    'reserved',
    'active',
    'returned',
    'cancelled'
  ])
});

export type RentalReservation = z.infer<typeof ReservationSchema>;

const reservationStore =
  new Map<string, RentalReservation>();

export function __resetRentalReservationCalendarStore(): void {
  reservationStore.clear();
}

function rangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA < endB && startB < endA;
}

function getEffectiveEnd(
  reservation: RentalReservation
): Date {
  return new Date(
    new Date(reservation.endDate).getTime() +
    reservation.bufferHoursAfter * 60 * 60 * 1000
  );
}

export async function checkAvailability(
  tenantId: string,
  actorId: string,
  assetId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'rental-reservation-calendar',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        start >= end
      ) {
        throw new AppError(
          'Invalid reservation date range',
          ErrorCode.BAD_REQUEST
        );
      }

      return !Array.from(reservationStore.values()).some(
        (reservation) => {
          if (
            reservation.tenantId !== tenantId ||
            reservation.assetId !== assetId ||
            reservation.status === 'cancelled' ||
            reservation.status === 'returned'
          ) {
            return false;
          }

          return rangesOverlap(
            start,
            end,
            new Date(reservation.startDate),
            getEffectiveEnd(reservation)
          );
        }
      );
    },
    auditAction: 'data.read',
    auditResource: 'rental_reservation',
    meterEventType: 'api_call'
  });
}

export async function createReservation(
  tenantId: string,
  actorId: string,
  assetId: string,
  clientId: string,
  startDate: string,
  endDate: string,
  bufferHoursAfter: number = 0
): Promise<RentalReservation> {
  return runCrudOperation({
    configName: 'rental-reservation-calendar',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        start >= end ||
        bufferHoursAfter < 0 ||
        !Number.isFinite(bufferHoursAfter)
      ) {
        throw new AppError(
          'Invalid reservation parameters',
          ErrorCode.BAD_REQUEST
        );
      }

      const available = !Array.from(
        reservationStore.values()
      ).some((reservation) => {
        if (
          reservation.tenantId !== tenantId ||
          reservation.assetId !== assetId ||
          reservation.status === 'cancelled' ||
          reservation.status === 'returned'
        ) {
          return false;
        }

        return rangesOverlap(
          start,
          end,
          new Date(reservation.startDate),
          getEffectiveEnd(reservation)
        );
      });

      if (!available) {
        throw new AppError(
          'Asset is unavailable for the requested period',
          ErrorCode.CONFLICT
        );
      }

      const reservation = ReservationSchema.parse({
        reservationId: crypto.randomUUID(),
        tenantId,
        assetId,
        clientId,
        startDate,
        endDate,
        bufferHoursAfter,
        status: 'reserved'
      });

      reservationStore.set(
        reservation.reservationId,
        reservation
      );

      return reservation;
    },
    auditAction: 'data.created',
    auditResource: 'rental_reservation',
    meterEventType: 'api_call'
  });
}

export async function getCalendar(
  tenantId: string,
  actorId: string,
  assetId: string,
  month: string
): Promise<RentalReservation[]> {
  return runCrudOperation({
    configName: 'rental-reservation-calendar',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const monthStart = new Date(month + '-01T00:00:00.000Z');

      if (Number.isNaN(monthStart.getTime())) {
        throw new AppError(
          'Invalid calendar month',
          ErrorCode.BAD_REQUEST
        );
      }

      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

      return Array.from(reservationStore.values())
        .filter((reservation) => {
          if (
            reservation.tenantId !== tenantId ||
            reservation.assetId !== assetId
          ) {
            return false;
          }

          const start = new Date(reservation.startDate);
          const end = getEffectiveEnd(reservation);

          return rangesOverlap(
            start,
            end,
            monthStart,
            monthEnd
          );
        })
        .sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
    },
    auditAction: 'data.read',
    auditResource: 'rental_reservation',
    meterEventType: 'api_call'
  });
}
