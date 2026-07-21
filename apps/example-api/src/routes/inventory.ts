import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { InventoryService } from '../../../../platform/inventory/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/movements', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth.sub;
    const result = await InventoryService.recordMovement(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/stock', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await InventoryService.fetchStockLevels(req.auth.tenantId);
    return ok(res, { stock: result });
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRouter };
