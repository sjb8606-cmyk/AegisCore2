/**
 * platform/class-capacity-waitlist (FIT-02)
 *
 * Class capacity, bookings, waitlist auto-promote, late-cancel penalties.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('class-capacity-waitlist');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  lateCancelHours: z.number().positive().default(2),
  autoPromoteFromWaitlist: z.boolean().default(true),
  defaultCapacity: z.number().int().positive().default(20),
});

export type BookingStatus =
  | 'booked'
  | 'waitlisted'
  | 'cancelled'
  | 'late_cancelled'
  | 'attended'
  | 'no_show';

export interface ClassSession {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  capacity: number;
  bookedCount: number;
}

export interface ClassBooking {
  id: string;
  tenantId: string;
  classId: string;
  memberId: string;
  status: BookingStatus;
  waitlistPosition: number | null;
  createdAt: string;
}

const classes = new Map<string, ClassSession>();
const bookings = new Map<string, ClassBooking>();

export function __resetClassCapacityStore(): void {
  classes.clear();
  bookings.clear();
}

function getClass(tenantId: string, classId: string): ClassSession {
  const c = classes.get(classId);
  if (!c || c.tenantId !== tenantId) {
    throw new AppError('Class not found', ErrorCode.NOT_FOUND);
  }
  return c;
}

function waitlistFor(tenantId: string, classId: string): ClassBooking[] {
  return [...bookings.values()]
    .filter(
      (b) =>
        b.tenantId === tenantId &&
        b.classId === classId &&
        b.status === 'waitlisted',
    )
    .sort((a, b) => (a.waitlistPosition || 0) - (b.waitlistPosition || 0));
}

function reindexWaitlist(tenantId: string, classId: string): void {
  const list = waitlistFor(tenantId, classId);
  list.forEach((b, i) => {
    b.waitlistPosition = i + 1;
    bookings.set(b.id, b);
  });
}

export async function createClassSession(
  tenantId: string,
  actorId: string,
  input: { name: string; startsAt: string; capacity?: number },
): Promise<ClassSession> {
  return runCrudOperation({
    configName: 'class-capacity-waitlist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('class-capacity-waitlist', ConfigSchema);
      if (!input.name?.trim()) {
        throw new AppError('name required', ErrorCode.BAD_REQUEST);
      }
      const starts = Date.parse(input.startsAt);
      if (Number.isNaN(starts)) {
        throw new AppError('invalid startsAt', ErrorCode.BAD_REQUEST);
      }
      const session: ClassSession = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        startsAt: new Date(starts).toISOString(),
        capacity: input.capacity ?? config.defaultCapacity,
        bookedCount: 0,
      };
      classes.set(session.id, session);
      return session;
    },
    auditAction: 'data.created',
    auditResource: 'fit_class_session',
    meterEventType: 'api_call',
  });
}

export async function bookClass(
  tenantId: string,
  actorId: string,
  input: { classId: string; memberId: string },
): Promise<ClassBooking> {
  return runCrudOperation({
    configName: 'class-capacity-waitlist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.memberId?.trim()) {
        throw new AppError('memberId required', ErrorCode.BAD_REQUEST);
      }
      const session = getClass(tenantId, input.classId);
      const existing = [...bookings.values()].find(
        (b) =>
          b.tenantId === tenantId &&
          b.classId === input.classId &&
          b.memberId === input.memberId &&
          (b.status === 'booked' || b.status === 'waitlisted'),
      );
      if (existing) {
        throw new AppError('Already booked or waitlisted', ErrorCode.CONFLICT);
      }

      let status: BookingStatus = 'booked';
      let waitlistPosition: number | null = null;
      if (session.bookedCount >= session.capacity) {
        status = 'waitlisted';
        waitlistPosition = waitlistFor(tenantId, input.classId).length + 1;
      } else {
        session.bookedCount += 1;
        classes.set(session.id, session);
      }

      const booking: ClassBooking = {
        id: crypto.randomUUID(),
        tenantId,
        classId: input.classId,
        memberId: input.memberId,
        status,
        waitlistPosition,
        createdAt: new Date().toISOString(),
      };
      bookings.set(booking.id, booking);
      return booking;
    },
    auditAction: 'data.created',
    auditResource: 'fit_class_booking',
    meterEventType: 'api_call',
  });
}

export async function cancelBooking(
  tenantId: string,
  actorId: string,
  bookingId: string,
  cancelledAt?: string,
): Promise<{ booking: ClassBooking; promoted: ClassBooking | null }> {
  return runCrudOperation({
    configName: 'class-capacity-waitlist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('class-capacity-waitlist', ConfigSchema);
      const booking = bookings.get(bookingId);
      if (!booking || booking.tenantId !== tenantId) {
        throw new AppError('Booking not found', ErrorCode.NOT_FOUND);
      }
      if (booking.status !== 'booked' && booking.status !== 'waitlisted') {
        throw new AppError('Booking not cancellable', ErrorCode.CONFLICT);
      }

      const session = getClass(tenantId, booking.classId);
      const at = cancelledAt ? Date.parse(cancelledAt) : Date.now();
      const hoursUntil = (Date.parse(session.startsAt) - at) / 3_600_000;
      const late =
        booking.status === 'booked' && hoursUntil < config.lateCancelHours;

      if (booking.status === 'booked') {
        session.bookedCount = Math.max(0, session.bookedCount - 1);
        classes.set(session.id, session);
      }

      booking.status = late ? 'late_cancelled' : 'cancelled';
      booking.waitlistPosition = null;
      bookings.set(bookingId, booking);

      let promoted: ClassBooking | null = null;
      if (
        config.autoPromoteFromWaitlist &&
        booking.status !== 'waitlisted'
      ) {
        const next = waitlistFor(tenantId, booking.classId)[0];
        if (next && session.bookedCount < session.capacity) {
          next.status = 'booked';
          next.waitlistPosition = null;
          session.bookedCount += 1;
          classes.set(session.id, session);
          bookings.set(next.id, next);
          reindexWaitlist(tenantId, booking.classId);
          promoted = next;
          logger.info(
            { promotedBookingId: next.id, classId: booking.classId },
            'Waitlist promoted',
          );
        }
      } else if (booking.status === 'cancelled' || booking.status === 'late_cancelled') {
        reindexWaitlist(tenantId, booking.classId);
      }

      return { booking, promoted };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'fit_class_booking',
    meterEventType: 'api_call',
  });
}

export async function getClassRoster(
  tenantId: string,
  actorId: string,
  classId: string,
): Promise<{ session: ClassSession; booked: ClassBooking[]; waitlist: ClassBooking[] }> {
  return runCrudOperation({
    configName: 'class-capacity-waitlist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const session = getClass(tenantId, classId);
      const booked = [...bookings.values()].filter(
        (b) =>
          b.tenantId === tenantId &&
          b.classId === classId &&
          b.status === 'booked',
      );
      const waitlist = waitlistFor(tenantId, classId);
      return { session, booked, waitlist };
    },
    auditAction: 'data.read',
    auditResource: 'fit_class_session',
    meterEventType: 'api_call',
  });
}
