import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createTable, createMenuItem, createOrder, updateOrderStatus, getKitchenQueue, AppError, isValidUuid } from '../../../../platform/restaurant/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected restaurant processing error occurred.',
    code: code
  });
}

const paths = {
  table: ['/tables', '/api/restaurant/tables'],
  menu: ['/menu', '/api/restaurant/menu'],
  order: ['/orders', '/api/restaurant/orders'],
  status: ['/orders/:id/status', '/api/restaurant/orders/:id/status'],
  kds: ['/kitchen/queue', '/api/restaurant/kitchen/queue']
};

router.post(paths.table, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createTable(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.menu, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createMenuItem(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.order, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await createOrder(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.status, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const orderId = req.params.id;
    if (!isValidUuid(orderId)) {
      throw new AppError(`Invalid Order ID format: '${orderId}'`, 'BAD_REQUEST');
    }
    const result = await updateOrderStatus(tenantId, orderId, req.body.status);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.kds, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await getKitchenQueue(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as restaurantRouter };
