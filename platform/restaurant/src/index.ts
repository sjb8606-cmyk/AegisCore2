import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const RestaurantConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    tableManagement: z.boolean().default(true),
    reservations: z.boolean().default(true),
    menuManagement: z.boolean().default(true),
    orderTaking: z.boolean().default(true),
    kitchenDisplaySystem: z.boolean().default(true),
    basicPayments: z.boolean().default(true),
    staffRoles: z.boolean().default(true),
    walkInQueue: z.boolean().default(true),
    splitBilling: z.boolean().default(false),
    inventoryIntegration: z.boolean().default(false),
    realTimeSync: z.boolean().default(false),
    dynamicPricing: z.boolean().default(false),
    deliveryIntegration: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
  }),
  limits: z.object({
    tablesPerTenant: z.number().default(10000),
    ordersPerDay: z.number().default(500000),
    reservationsPerMonth: z.number().default(200000),
  }),
  thresholds: z.object({
    tableHoldMinutes: z.number().default(15),
    reservationGraceMinutes: z.number().default(10),
    kitchenLatencyTargetMs: z.number().default(500),
  }),
});

export type RestaurantConfig = z.infer<typeof RestaurantConfigSchema>;

function loadConfig(): RestaurantConfig {
  const configPath = path.join(process.cwd(), 'config', 'restaurant.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return RestaurantConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      tableManagement: true,
      reservations: true,
      menuManagement: true,
      orderTaking: true,
      kitchenDisplaySystem: true,
      basicPayments: true,
      staffRoles: true,
      walkInQueue: true,
      splitBilling: false,
      inventoryIntegration: false,
      realTimeSync: false,
      dynamicPricing: false,
      deliveryIntegration: false,
      auditTrail: true,
      advancedAnalytics: false
    },
    limits: { tablesPerTenant: 10000, ordersPerDay: 500000, reservationsPerMonth: 200000 },
    thresholds: { tableHoldMinutes: 15, reservationGraceMinutes: 10, kitchenLatencyTargetMs: 500 }
  };
}

export async function createTable(tenantId: string, data: any) {
  const tableId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO rest_tables (id, tenant_id, table_number, capacity)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [tableId, tenantId, data.table_number, data.capacity], tenantId);
  return res[0];
}

export async function createMenuItem(tenantId: string, data: any) {
  const itemId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO rest_menu_items (id, tenant_id, name, description, price_cents)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [itemId, tenantId, data.name, data.description || null, data.price_cents], tenantId);
  return res[0];
}

export async function createOrder(tenantId: string, userId: string, input: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Restaurant module disabled', 'FORBIDDEN');

  if (input.table_id) {
    if (!isValidUuid(input.table_id)) throw new AppError('Invalid Table ID format.', 'BAD_REQUEST');
    
    // Atomic check: Verify table is available
    const tableRes = await withTenantQuery(`
      SELECT status FROM rest_tables WHERE id = $1 AND tenant_id = $2;
    `, [input.table_id, tenantId], tenantId);

    if (!tableRes || tableRes.length === 0) throw new AppError('Table not found.', 'NOT_FOUND');
    if (tableRes[0].status !== 'available') {
      throw new AppError('Table is currently occupied or reserved.', 'BAD_REQUEST');
    }

    // Atomic update: Set table to occupied
    await withTenantQuery(`
      UPDATE rest_tables SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2;
    `, [input.table_id, tenantId], tenantId);
  }

  const orderId = crypto.randomUUID();
  let totalCents = 0;

  // Insert base order
  await withTenantQuery(`
    INSERT INTO rest_orders (id, tenant_id, table_id, status)
    VALUES ($1, $2, $3, 'placed');
  `, [orderId, tenantId, input.table_id || null], tenantId);

  // Process items and summarize total cost
  if (input.items && Array.isArray(input.items)) {
    for (const item of input.items) {
      if (!isValidUuid(item.menu_item_id)) throw new AppError('Invalid Menu Item ID format.', 'BAD_REQUEST');

      const menuRes = await withTenantQuery(`
        SELECT price_cents FROM rest_menu_items WHERE id = $1 AND tenant_id = $2;
      `, [item.menu_item_id, tenantId], tenantId);
      
      const menuItem = menuRes[0];
      if (!menuItem) throw new AppError('Menu item not found.', 'NOT_FOUND');

      const price = parseInt(menuItem.price_cents, 10);
      const lineCost = price * parseInt(item.quantity, 10);
      totalCents += lineCost;

      await withTenantQuery(`
        INSERT INTO rest_order_items (id, tenant_id, order_id, menu_item_id, quantity, price_cents)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [crypto.randomUUID(), tenantId, orderId, item.menu_item_id, item.quantity, price], tenantId);
    }
  }

  // Update order with cumulative cost summary
  const orderRes = await withTenantQuery(`
    UPDATE rest_orders SET total_cents = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [totalCents, orderId, tenantId], tenantId);

  return orderRes[0];
}

// State Machine Validation & State transitions
export async function updateOrderStatus(tenantId: string, orderId: string, newStatus: string) {
  if (!isValidUuid(orderId)) throw new AppError('Invalid Order ID format.', 'BAD_REQUEST');

  const orderRes = await withTenantQuery(`
    SELECT * FROM rest_orders WHERE id = $1 AND tenant_id = $2;
  `, [orderId, tenantId], tenantId);
  const order = orderRes[0];
  if (!order) throw new AppError('Order not found.', 'NOT_FOUND');

  const current = order.status;

  // State Transition Machine Rules:
  // placed -> preparing -> ready -> served -> paid
  // Any status (except paid) can transition to canceled
  let allowed = false;
  if (newStatus === 'canceled' && current !== 'paid') {
    allowed = true;
  } else if (current === 'placed' && newStatus === 'preparing') {
    allowed = true;
  } else if (current === 'preparing' && newStatus === 'ready') {
    allowed = true;
  } else if (current === 'ready' && newStatus === 'served') {
    allowed = true;
  } else if (current === 'served' && newStatus === 'paid') {
    allowed = true;
  }

  if (!allowed) {
    throw new AppError(`Forbidden state transition from '${current}' to '${newStatus}'.`, 'BAD_REQUEST');
  }

  const updatedOrderRes = await withTenantQuery(`
    UPDATE rest_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [newStatus, orderId, tenantId], tenantId);

  // If order is completed (paid) or canceled, reset the table back to available
  if ((newStatus === 'paid' || newStatus === 'canceled') && order.table_id) {
    await withTenantQuery(`
      UPDATE rest_tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2;
    `, [order.table_id, tenantId], tenantId);
  }

  return updatedOrderRes[0];
}

export async function getKitchenQueue(tenantId: string) {
  // Returns KDS ticket log (placed, preparing, and ready statuses)
  const queue = await withTenantQuery(`
    SELECT o.id as order_id, o.status, o.created_at, t.table_number,
           JSON_AGG(JSON_BUILD_OBJECT('name', mi.name, 'quantity', oi.quantity)) as items
    FROM rest_orders o
    LEFT JOIN rest_tables t ON o.table_id = t.id
    JOIN rest_order_items oi ON o.id = oi.order_id
    JOIN rest_menu_items mi ON oi.menu_item_id = mi.id
    WHERE o.tenant_id = $1 AND o.status IN ('placed', 'preparing', 'ready')
    GROUP BY o.id, t.table_number
    ORDER BY o.created_at ASC;
  `, [tenantId], tenantId);

  return queue;
}
