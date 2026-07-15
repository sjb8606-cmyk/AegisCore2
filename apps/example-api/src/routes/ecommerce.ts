import { Router, Request, Response } from 'express';
import { createStorefront, createProduct, createCart, addCartItem, createOrderFromCart, getStorefrontLedger, AppError, isValidUuid } from '../../../../platform/ecommerce/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw new AppError('Missing x-tenant-id', 'BAD_REQUEST');
  return { tenantId, userId };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected storefront exception occurred.',
    code: code
  });
}

const paths = {
  storefront: ['/storefronts', '/api/ecommerce/storefronts'],
  product: ['/products', '/api/ecommerce/products'],
  cart: ['/carts', '/api/ecommerce/carts'],
  items: ['/carts/:id/items', '/api/ecommerce/carts/:id/items'],
  checkout: ['/carts/:id/checkout', '/api/ecommerce/carts/:id/checkout'],
  ledger: ['/storefronts/:id/ledger', '/api/ecommerce/storefronts/:id/ledger']
};

router.post(paths.storefront, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createStorefront(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.product, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createProduct(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.cart, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createCart(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.items, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const cartId = req.params.id;
    if (!isValidUuid(cartId)) {
      throw new AppError(`Invalid Cart ID format: '${cartId}'`, 'BAD_REQUEST');
    }
    const result = await addCartItem(tenantId, cartId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.checkout, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const cartId = req.params.id;
    if (!isValidUuid(cartId)) {
      throw new AppError(`Invalid Cart ID format: '${cartId}'`, 'BAD_REQUEST');
    }
    const result = await createOrderFromCart(tenantId, cartId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const storefrontId = req.params.id;
    if (!isValidUuid(storefrontId)) {
      throw new AppError(`Invalid Storefront ID format: '${storefrontId}'`, 'BAD_REQUEST');
    }
    const result = await getStorefrontLedger(tenantId, storefrontId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as ecommerceRouter, router as 'ecommerceRouter' };
