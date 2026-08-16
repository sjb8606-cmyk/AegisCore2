import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const MovementInputSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  type: z.enum(['receive', 'ship', 'adjust', 'transfer', 'return', 'write_off']),
  quantity: z.number().int().min(1),
  notes: z.string().optional(),
});

export const CreateItemInputSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
});

export const InventoryConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    multiLocation: z.boolean().default(false),
    supplierManagement: z.boolean().default(false),
    purchaseOrders: z.boolean().default(false),
    barcodeSupport: z.boolean().default(false),
    lotTracking: z.boolean().default(false),
    expiryTracking: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    lowStockAlerts: z.boolean().default(true),
    exportReports: z.boolean().default(false),
    adjustmentApproval: z.boolean().default(false),
  }),
  limits: z.object({
    productCount: z.number().default(100),
    locationCount: z.number().default(1),
    supplierCount: z.number().default(0),
    lowStockThreshold: z.number().default(10),
  }),
});

export type InventoryConfig = z.infer<typeof InventoryConfigSchema>;

let cachedConfig: InventoryConfig | null = null;

export function loadConfig(): InventoryConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/inventory.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = InventoryConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = InventoryConfigSchema.parse({
    enabled: true,
    tiers: {
      multiLocation: false,
      supplierManagement: false,
      purchaseOrders: false,
      barcodeSupport: false,
      lotTracking: false,
      expiryTracking: false,
      auditTrail: false,
      lowStockAlerts: true,
      exportReports: false,
      adjustmentApproval: false,
    },
    limits: {
      productCount: 100,
      locationCount: 1,
      supplierCount: 0,
      lowStockThreshold: 10,
    }
  });
  return cachedConfig;
}

export class InventoryService {
  static async createItem(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Inventory globally disabled', ErrorCode.FORBIDDEN);
    }
    parseUserId(userId);
    const input = CreateItemInputSchema.parse(data);

    const sql = `
      INSERT INTO inventory_items (tenant_id, name, sku)
      VALUES ($1::uuid, $2, $3)
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [tenantId, input.name, input.sku], tenantId);
    return rows[0];
  }

  static async recordMovement(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Inventory globally disabled', ErrorCode.FORBIDDEN);
    }

    const input = MovementInputSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const defaultLocation = '00000000-0000-0000-0000-000000000001';
    const locationId = input.locationId || defaultLocation;
    const itemId = input.itemId;

    const itemCheckSql = `SELECT id FROM inventory_items WHERE tenant_id = $1::uuid AND id = $2::uuid LIMIT 1`;
    const itemCheckRows = await withTenantQuery(itemCheckSql, [tenantId, itemId], tenantId);
    if (!itemCheckRows || itemCheckRows.length === 0) {
      throw new AppError(
        `Item ${itemId} does not exist for this tenant. Create it first via InventoryService.createItem().`,
        ErrorCode.NOT_FOUND
      );
    }

    const levelSql = `
      SELECT quantity FROM stock_levels 
      WHERE tenant_id = $1::uuid AND item_id = $2::uuid AND location_id = $3::uuid
    `;
    const levelRows = await withTenantQuery(levelSql, [tenantId, itemId, locationId], tenantId);
    const beforeQty = levelRows && levelRows.length > 0 ? Number(levelRows[0].quantity) : 0;

    let afterQty = beforeQty;
    if (input.type === 'receive' || input.type === 'return') {
      afterQty += input.quantity;
    } else if (input.type === 'ship' || input.type === 'write_off' || input.type === 'adjust') {
      afterQty -= input.quantity;
    }

    if (afterQty < 0) {
      throw new AppError('Insufficient stock levels to process movement transaction', ErrorCode.FORBIDDEN);
    }

    const movementSql = `
      INSERT INTO stock_movements (tenant_id, item_id, location_id, type, quantity, before_qty, after_qty, performed_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid)
    `;
    await withTenantQuery(movementSql, [
      tenantId,
      itemId,
      locationId,
      input.type,
      input.quantity,
      beforeQty,
      afterQty,
      cleanUserId
    ], tenantId);

    const upsertSql = `
      INSERT INTO stock_levels (tenant_id, item_id, location_id, quantity, updated_at)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, NOW())
      ON CONFLICT (tenant_id, item_id, location_id) 
      DO UPDATE SET quantity = $4, updated_at = NOW()
      RETURNING *
    `;
    const upsertRows = await withTenantQuery(upsertSql, [tenantId, itemId, locationId, afterQty], tenantId);
    return upsertRows[0];
  }

  static async fetchStockLevels(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, item_id, location_id, quantity, updated_at 
      FROM stock_levels 
      WHERE tenant_id = $1::uuid
      ORDER BY quantity ASC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
