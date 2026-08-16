import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const PropertyManagementConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    propertyRegistry: z.boolean().default(true),
    unitManagement: z.boolean().default(true),
    tenantManagement: z.boolean().default(true),
    leaseManagement: z.boolean().default(true),
    rentTracking: z.boolean().default(true)
  })
});

export type PropertyManagementConfig = z.infer<typeof PropertyManagementConfigSchema>;

function loadConfig(): PropertyManagementConfig {
  const configPath = path.join(process.cwd(), 'config', 'property-management.json');
  try {
    if (fs.existsSync(configPath)) {
      return PropertyManagementConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { propertyRegistry: true, unitManagement: true, tenantManagement: true, leaseManagement: true, rentTracking: true } };
}

export async function createProperty(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Property Management disabled', 'FORBIDDEN');
  
  const propertyId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO pm_properties (id, tenant_id, name, address)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [propertyId, tenantId, data.name, data.address], tenantId);
  return res[0];
}

export async function createUnit(tenantId: string, data: any) {
  if (!isValidUuid(data.property_id)) throw new AppError('Invalid Property ID format.', 'BAD_REQUEST');
  const unitId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO pm_units (id, tenant_id, property_id, unit_number, status)
    VALUES ($1, $2, $3, $4, 'vacant') RETURNING *;
  `, [unitId, tenantId, data.property_id, data.unit_number], tenantId);
  return res[0];
}

export async function createTenant(tenantId: string, data: any) {
  const tId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO pm_tenants (id, tenant_id, name, email, phone)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [tId, tenantId, data.name, data.email, data.phone || null], tenantId);
  return res[0];
}

export async function createLease(tenantId: string, data: any) {
  if (!isValidUuid(data.unit_id) || !isValidUuid(data.tenant_profile_id)) {
    throw new AppError('Invalid ID formats (Unit or Tenant).', 'BAD_REQUEST');
  }

  // Atomic state check: Confirm unit is vacant
  const unitRes = await withTenantQuery(`
    SELECT status FROM pm_units WHERE id = $1 AND tenant_id = $2;
  `, [data.unit_id, tenantId], tenantId);
  
  if (!unitRes || unitRes.length === 0) throw new AppError('Unit not found.', 'NOT_FOUND');
  if (unitRes[0].status !== 'vacant') {
    throw new AppError('Unit is not available for leasing (already occupied or in maintenance).', 'CONFLICT');
  }

  const leaseId = crypto.randomUUID();
  
  // Insert lease
  const leaseRes = await withTenantQuery(`
    INSERT INTO pm_leases (id, tenant_id, unit_id, tenant_profile_id, start_date, end_date, rent_amount_cents, deposit_amount_cents, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active') RETURNING *;
  `, [leaseId, tenantId, data.unit_id, data.tenant_profile_id, data.start_date, data.end_date || null, data.rent_amount_cents, data.deposit_amount_cents || 0], tenantId);

  // Update unit status to occupied
  await withTenantQuery(`
    UPDATE pm_units SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2;
  `, [data.unit_id, tenantId], tenantId);

  return leaseRes[0];
}

export async function recordRentPayment(tenantId: string, leaseId: string, amountCents: number) {
  if (!isValidUuid(leaseId)) throw new AppError('Invalid Lease ID format.', 'BAD_REQUEST');
  
  const paymentId = crypto.randomUUID();
  const receiptNum = `RCPT-${Math.floor(100000 + Math.random() * 900000)}`;

  const res = await withTenantQuery(`
    INSERT INTO pm_rent_payments (id, tenant_id, lease_id, amount_cents, receipt_number)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [paymentId, tenantId, leaseId, amountCents, receiptNum], tenantId);

  return res[0];
}

export async function getUnitLedger(tenantId: string, unitId: string) {
  if (!isValidUuid(unitId)) throw new AppError('Invalid Unit ID format.', 'BAD_REQUEST');

  const unitRes = await withTenantQuery(`
    SELECT * FROM pm_units WHERE id = $1 AND tenant_id = $2;
  `, [unitId, tenantId], tenantId);
  const unit = unitRes[0];
  if (!unit) throw new AppError('Unit not found.', 'NOT_FOUND');

  const leases = await withTenantQuery(`
    SELECT l.*, t.name as tenant_name, t.email as tenant_email
    FROM pm_leases l
    JOIN pm_tenants t ON l.tenant_profile_id = t.id
    WHERE l.unit_id = $1 AND l.tenant_id = $2
    ORDER BY l.created_at DESC;
  `, [unitId, tenantId], tenantId);

  for (const lease of leases) {
    const payments = await withTenantQuery(`
      SELECT * FROM pm_rent_payments WHERE lease_id = $1 AND tenant_id = $2 ORDER BY payment_date DESC;
    `, [lease.id, tenantId], tenantId);
    lease.payments = payments;
  }

  return { ...unit, leases };
}
