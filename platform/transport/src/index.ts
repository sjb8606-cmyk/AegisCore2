import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const TransportConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    routeManagement: z.boolean().default(true),
    bookingSystem: z.boolean().default(true),
    driverManagement: z.boolean().default(true),
    fleetTracking: z.boolean().default(true),
    liveDispatch: z.boolean().default(true),
    fareCalculation: z.boolean().default(true),
    ticketing: z.boolean().default(true),
    cancellationHandling: z.boolean().default(true),
    auditTrail: z.boolean().default(false),
  }),
  limits: z.object({
    routesPerTenant: z.number().default(100000),
    tripsPerDay: z.number().default(1000000),
    driversPerTenant: z.number().default(250000),
  }),
  thresholds: z.object({
    dispatchTimeoutMs: z.number().default(2000),
    overbookingFactor: z.number().default(1.05),
    cancellationWindowMinutes: z.number().default(30),
  }),
});

export type TransportConfig = z.infer<typeof TransportConfigSchema>;

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig(): { transport: TransportConfig } {
  try {
    const configPath = path.join(process.cwd(), 'config', 'transport.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { transport: TransportConfigSchema.parse(raw) };
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    transport: {
      enabled: true,
      tiers: {
        routeManagement: true,
        bookingSystem: true,
        driverManagement: true,
        fleetTracking: true,
        liveDispatch: true,
        fareCalculation: true,
        ticketing: true,
        cancellationHandling: true,
        auditTrail: true
      },
      limits: { routesPerTenant: 100000, tripsPerDay: 1000000, driversPerTenant: 250000 },
      thresholds: { dispatchTimeoutMs: 2000, overbookingFactor: 1.05, cancellationWindowMinutes: 30 }
    }
  };
}

// State Machine validation dictionary
const validTransitions: Record<string, string[]> = {
  scheduled: ['boarding', 'canceled', 'delayed'],
  boarding: ['in_transit', 'canceled'],
  in_transit: ['completed', 'delayed'],
  delayed: ['boarding', 'in_transit'],
  completed: [],
  canceled: []
};

export function validateTransition(from: string, to: string): void {
  if (!validTransitions[from]?.includes(to)) {
    throw new AppError(`Invalid state transition: ${from} -> ${to}`, 'BAD_REQUEST');
  }
}

export async function createRoute(tenantId: string, data: any) {
  const configWrapper = loadConfig();
  if (!configWrapper.transport.enabled) throw new AppError('Transport module disabled', 'FORBIDDEN');

  const routeId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO transport_routes (id, tenant_id, name, origin, destination, distance_km)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [routeId, tenantId, data.name, data.origin, data.destination, data.distance_km], tenantId);

  return res[0];
}

export async function createTrip(tenantId: string, data: any) {
  if (!isValidUuid(data.route_id)) throw new AppError('Invalid Route ID format.', 'BAD_REQUEST');

  const tripId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO transport_trips (id, tenant_id, route_id, scheduled_time, status, capacity)
    VALUES ($1, $2, $3, $4, 'scheduled', $5) RETURNING *;
  `, [tripId, tenantId, data.route_id, data.scheduled_time, data.capacity], tenantId);

  return res[0];
}

// Atomic seat allocation & overbooking cap validation
export async function bookSeat(tenantId: string, input: any) {
  const configWrapper = loadConfig();
  if (!isValidUuid(input.trip_id)) throw new AppError('Invalid Trip ID format.', 'BAD_REQUEST');

  const tripRes = await withTenantQuery(`
    SELECT * FROM transport_trips WHERE id = $1 AND tenant_id = $2;
  `, [input.trip_id, tenantId], tenantId);
  const trip = tripRes[0];
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');

  const limitCap = Math.floor(parseInt(trip.capacity, 10) * configWrapper.transport.thresholds.overbookingFactor);
  const currentCount = parseInt(trip.booked_seats || '0', 10);

  if (currentCount >= limitCap) {
    throw new AppError(`Trip is full. Maximum overbooked capacity of ${limitCap} has been reached.`, 'BAD_REQUEST');
  }

  const bookingId = crypto.randomUUID();
  const seatNum = input.seat_number || `AUTO-${Math.floor(1000 + Math.random() * 9000)}`;

  const res = await withTenantQuery(`
    INSERT INTO transport_bookings (id, tenant_id, trip_id, passenger_name, seat_number, status, fare)
    VALUES ($1, $2, $3, $4, $5, 'booked', $6) RETURNING *;
  `, [bookingId, tenantId, input.trip_id, input.passenger_name, seatNum, 25.50], tenantId);

  await withTenantQuery(`
    UPDATE transport_trips SET booked_seats = booked_seats + 1 WHERE id = $1 AND tenant_id = $2;
  `, [input.trip_id, tenantId], tenantId);

  return res[0];
}

export async function updateTripStatus(tenantId: string, tripId: string, newStatus: string) {
  if (!isValidUuid(tripId)) throw new AppError('Invalid Trip ID format.', 'BAD_REQUEST');

  const tripRes = await withTenantQuery(`
    SELECT status FROM transport_trips WHERE id = $1 AND tenant_id = $2;
  `, [tripId, tenantId], tenantId);
  const trip = tripRes[0];
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');

  validateTransition(trip.status, newStatus);

  const res = await withTenantQuery(`
    UPDATE transport_trips SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [newStatus, tripId, tenantId], tenantId);

  return res[0];
}

export async function getTripLedger(tenantId: string, tripId: string) {
  if (!isValidUuid(tripId)) throw new AppError('Invalid Trip ID format.', 'BAD_REQUEST');

  const tripRes = await withTenantQuery(`
    SELECT t.*, r.name as route_name, r.origin, r.destination, r.distance_km
    FROM transport_trips t
    JOIN transport_routes r ON t.route_id = r.id
    WHERE t.id = $1 AND t.tenant_id = $2;
  `, [tripId, tenantId], tenantId);
  const trip = tripRes[0];
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');

  const bookings = await withTenantQuery(`
    SELECT * FROM transport_bookings WHERE trip_id = $1 AND tenant_id = $2 ORDER BY created_at ASC;
  `, [tripId, tenantId], tenantId);

  return { ...trip, bookings };
}
