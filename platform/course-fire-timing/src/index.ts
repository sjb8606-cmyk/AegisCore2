/**
 * platform/course-fire-timing (REST-02)
 *
 * Course-based ticket pacing: hold → fire → bumped.
 * Kitchen works by course, not only by full ticket.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('course-fire-timing');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultCourses: z
    .array(z.string())
    .default(['appetizer', 'entree', 'dessert']),
  autoFireNextOnBump: z.boolean().default(false),
});

export type CourseState = 'pending' | 'held' | 'fired' | 'bumped';

export interface CourseTicket {
  id: string;
  tenantId: string;
  orderId: string;
  tableLabel: string | null;
  courses: Array<{
    name: string;
    state: CourseState;
    firedAt: string | null;
    bumpedAt: string | null;
  }>;
  createdAt: string;
}

const tickets = new Map<string, CourseTicket>();

export function __resetCourseFireStore(): void {
  tickets.clear();
}

function getTicket(tenantId: string, ticketId: string): CourseTicket {
  const t = tickets.get(ticketId);
  if (!t || t.tenantId !== tenantId) {
    throw new AppError('Course ticket not found', ErrorCode.NOT_FOUND);
  }
  return t;
}

export async function openCourseTicket(
  tenantId: string,
  actorId: string,
  input: {
    orderId: string;
    tableLabel?: string;
    courses?: string[];
  },
): Promise<CourseTicket> {
  return runCrudOperation({
    configName: 'course-fire-timing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('course-fire-timing', ConfigSchema);
      if (!input.orderId?.trim()) {
        throw new AppError('orderId required', ErrorCode.BAD_REQUEST);
      }
      const names =
        input.courses && input.courses.length > 0
          ? input.courses
          : config.defaultCourses;
      const ticket: CourseTicket = {
        id: crypto.randomUUID(),
        tenantId,
        orderId: input.orderId,
        tableLabel: input.tableLabel?.trim() || null,
        courses: names.map((name) => ({
          name,
          state: 'held' as CourseState,
          firedAt: null,
          bumpedAt: null,
        })),
        createdAt: new Date().toISOString(),
      };
      // First course ready to fire by convention: still held until expo fires
      tickets.set(ticket.id, ticket);
      return ticket;
    },
    auditAction: 'data.created',
    auditResource: 'rest_course_ticket',
    meterEventType: 'api_call',
  });
}

export async function fireCourse(
  tenantId: string,
  actorId: string,
  ticketId: string,
  courseName: string,
): Promise<CourseTicket> {
  return runCrudOperation({
    configName: 'course-fire-timing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const ticket = getTicket(tenantId, ticketId);
      const course = ticket.courses.find(
        (c) => c.name.toLowerCase() === courseName.toLowerCase(),
      );
      if (!course) {
        throw new AppError('Course not on ticket', ErrorCode.NOT_FOUND);
      }
      if (course.state === 'fired' || course.state === 'bumped') {
        throw new AppError('Course already fired or bumped', ErrorCode.CONFLICT);
      }
      course.state = 'fired';
      course.firedAt = new Date().toISOString();
      tickets.set(ticketId, ticket);
      logger.info(
        { ticketId, course: course.name, orderId: ticket.orderId },
        'Course fired',
      );
      return ticket;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'rest_course_ticket',
    meterEventType: 'api_call',
  });
}

export async function bumpCourse(
  tenantId: string,
  actorId: string,
  ticketId: string,
  courseName: string,
): Promise<CourseTicket> {
  return runCrudOperation({
    configName: 'course-fire-timing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('course-fire-timing', ConfigSchema);
      const ticket = getTicket(tenantId, ticketId);
      const idx = ticket.courses.findIndex(
        (c) => c.name.toLowerCase() === courseName.toLowerCase(),
      );
      if (idx < 0) {
        throw new AppError('Course not on ticket', ErrorCode.NOT_FOUND);
      }
      const course = ticket.courses[idx];
      if (course.state !== 'fired') {
        throw new AppError('Only fired courses can be bumped', ErrorCode.CONFLICT);
      }
      course.state = 'bumped';
      course.bumpedAt = new Date().toISOString();

      if (config.autoFireNextOnBump) {
        const next = ticket.courses.slice(idx + 1).find((c) => c.state === 'held');
        if (next) {
          next.state = 'fired';
          next.firedAt = new Date().toISOString();
        }
      }
      tickets.set(ticketId, ticket);
      return ticket;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_course_ticket',
    meterEventType: 'api_call',
  });
}

export async function holdCourse(
  tenantId: string,
  actorId: string,
  ticketId: string,
  courseName: string,
): Promise<CourseTicket> {
  return runCrudOperation({
    configName: 'course-fire-timing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const ticket = getTicket(tenantId, ticketId);
      const course = ticket.courses.find(
        (c) => c.name.toLowerCase() === courseName.toLowerCase(),
      );
      if (!course) {
        throw new AppError('Course not on ticket', ErrorCode.NOT_FOUND);
      }
      if (course.state === 'bumped') {
        throw new AppError('Cannot hold a bumped course', ErrorCode.CONFLICT);
      }
      course.state = 'held';
      course.firedAt = null;
      tickets.set(ticketId, ticket);
      return ticket;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_course_ticket',
    meterEventType: 'api_call',
  });
}

export async function getKitchenCourseQueue(
  tenantId: string,
  actorId: string,
): Promise<
  Array<{
    ticketId: string;
    orderId: string;
    tableLabel: string | null;
    courseName: string;
    firedAt: string;
  }>
> {
  return runCrudOperation({
    configName: 'course-fire-timing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rows: Array<{
        ticketId: string;
        orderId: string;
        tableLabel: string | null;
        courseName: string;
        firedAt: string;
      }> = [];
      for (const t of tickets.values()) {
        if (t.tenantId !== tenantId) continue;
        for (const c of t.courses) {
          if (c.state === 'fired' && c.firedAt) {
            rows.push({
              ticketId: t.id,
              orderId: t.orderId,
              tableLabel: t.tableLabel,
              courseName: c.name,
              firedAt: c.firedAt,
            });
          }
        }
      }
      return rows.sort(
        (a, b) => Date.parse(a.firedAt) - Date.parse(b.firedAt),
      );
    },
    auditAction: 'data.read',
    auditResource: 'rest_course_ticket',
    meterEventType: 'api_call',
  });
}
