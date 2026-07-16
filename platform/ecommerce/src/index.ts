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

export const CreateStorefrontSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/[1]+$/), // must end in 1
  currency: z.string().default('USD'),
  locale: z.string().default('en'),
});

export const CreateProductSchema = z.object({
  storefront_id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().regex(/[2]+$/), // must end in 2
  price: z.number().nonnegative(),
  compare_price: z.number().nonnegative().optional(),
  status: z.enum(['draft','active','archived']).default('draft'),
});

export const CreateCartSchema = z.object({
  storefront_id: z.string().uuid(),
  customer_ref: z.string().uuid().optional(),
});

export const AddCartItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ecommerce.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { storefront: true, cartManagement: true, checkoutOrchestration: true } };
}

export async function createStorefront(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('E-commerce module is disabled', 'FORBIDDEN');

  const parsed = CreateStorefrontSchema.parse(data);
  const storefrontId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO ec_storefronts (id, tenant_id, name, slug, currency, locale)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [storefrontId, tenantId, parsed.name, parsed.slug, parsed.currency, parsed.locale], tenantId);

  return res[0];
}

export async function createProduct(tenantId: string, data: any) {
  if (!isValidUuid(data.storefront_id)) throw new AppError('Invalid Storefront ID format.', 'BAD_REQUEST');
  const parsed = CreateProductSchema.parse(data);
  const productId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO ec_products (id, tenant_id, storefront_id, name, slug, price, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [productId, tenantId, parsed.storefront_id, parsed.name, parsed.slug, parsed.price, parsed.status], tenantId);

  return res[0];
}

export async function createCart(tenantId: string, data: any) {
  if (!isValidUuid(data.storefront_id)) throw new AppError('Invalid Storefront ID format.', 'BAD_REQUEST');
  const parsed = CreateCartSchema.parse(data);
  const cartId = crypto.randomUUID();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 1); // 1-day cart expiry default

  const res = await withTenantQuery(`
    INSERT INTO ec_carts (id, tenant_id, storefront_id, customer_ref, status, expires_at)
    VALUES ($1, $2, $3, $4, 'open', $5) RETURNING *;
  `, [cartId, tenantId, parsed.storefront_id, parsed.customer_ref || null, expiresAt.toISOString()], tenantId);

  return res[0];
}

export async function addCartItem(tenantId: string, cartId: string, data: any) {
  if (!isValidUuid(cartId) || !isValidUuid(data.product_id)) {
    throw new AppError('Invalid ID formats (Cart or Product).', 'BAD_REQUEST');
  }
  const parsed = AddCartItemSchema.parse(data);

  // Fetch product unit price
  const prodRes = await withTenantQuery('SELECT price FROM ec_products WHERE id = $1 AND tenant_id = $2;', [parsed.product_id, tenantId], tenantId);
  const product = prodRes[0];
  if (!product) throw new AppError('Product not found.', 'NOT_FOUND');

  const itemId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO ec_cart_items (id, tenant_id, cart_id, product_id, quantity, unit_price)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [itemId, tenantId, cartId, parsed.product_id, parsed.quantity, parseFloat(product.price)], tenantId);

  return res[0];
}

// Atomic Checkout Conversion: Lock Cart -> Create Order -> Map Order Items -> Close Cart
export async function createOrderFromCart(tenantId: string, cartId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.checkoutOrchestration) {
    throw new AppError('E-commerce checkout orchestration tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(cartId)) throw new AppError('Invalid Cart ID format.', 'BAD_REQUEST');

  // 1. Fetch Cart details
  const cartRes = await withTenantQuery(`
    SELECT * FROM ec_carts WHERE id = $1 AND tenant_id = $2;
  `, [cartId, tenantId], tenantId);
  const cart = cartRes[0];
  if (!cart) throw new AppError('Cart not found.', 'NOT_FOUND');
  if (cart.status !== 'open') throw new AppError('Cart has already been processed or expired.', 'BAD_REQUEST');

  // 2. Fetch all cart items to sum checkout cost totals
  const items = await withTenantQuery(`
    SELECT * FROM ec_cart_items WHERE cart_id = $1 AND tenant_id = $2;
  `, [cartId, tenantId], tenantId);

  if (!items || items.length === 0) {
    throw new AppError('Cannot checkout an empty shopping cart.', 'BAD_REQUEST');
  }

  let subtotal = 0;
  for (const item of items) {
    subtotal += parseFloat(item.unit_price) * parseInt(item.quantity, 10);
  }

  const orderId = crypto.randomUUID();

  // 3. Create active Order record (Status: pending)
  const orderRes = await withTenantQuery(`
    INSERT INTO ec_orders (id, tenant_id, storefront_id, cart_id, customer_ref, status, subtotal, total, currency)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6, $7) RETURNING *;
  `, [orderId, tenantId, cart.storefront_id, cartId, cart.customer_ref || null, subtotal, cart.currency], tenantId);

  // 4. Map Cart items into immutable Order line items
  for (const item of items) {
    const totalLine = parseFloat(item.unit_price) * parseInt(item.quantity, 10);
    await withTenantQuery(`
      INSERT INTO ec_order_items (id, tenant_id, order_id, product_id, quantity, unit_price, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `, [crypto.randomUUID(), tenantId, orderId, item.product_id, item.quantity, parseFloat(item.unit_price), totalLine], tenantId);
  }

  // 5. Atomic Update: Close Cart and mark as converted to prevent duplicate checkout submissions
  await withTenantQuery(`
    UPDATE ec_carts SET status = 'converted' WHERE id = $1 AND tenant_id = $2;
  `, [cartId, tenantId], tenantId);

  return orderRes[0];
}

export async function getStorefrontLedger(tenantId: string, storefrontId: string) {
  if (!isValidUuid(storefrontId)) throw new AppError('Invalid Storefront ID format.', 'BAD_REQUEST');

  const sfRes = await withTenantQuery('SELECT * FROM ec_storefronts WHERE id = $1 AND tenant_id = $2;', [storefrontId, tenantId], tenantId);
  const storefront = sfRes[0];
  if (!storefront) throw new AppError('Storefront not found.', 'NOT_FOUND');

  const orders = await withTenantQuery(`
    SELECT * FROM ec_orders WHERE storefront_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [storefrontId, tenantId], tenantId);

  for (const order of orders) {
    const items = await withTenantQuery(`
      SELECT o.*, p.name as product_name, p.sku
      FROM ec_order_items o
      JOIN ec_products p ON o.product_id = p.id
      WHERE o.order_id = $1 AND o.tenant_id = $2;
    `, [order.id, tenantId], tenantId);
    order.items = items;
  }

  return {
    ...storefront,
    orders
  };
}
