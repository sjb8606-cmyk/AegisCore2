import { Router } from 'express';
import { createProduct } from '../../../../platform/ecommerce/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

// This will match /api/ecommerce/products
router.post('/products', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const product = await createProduct(req.auth.tenantId, req.body);
    return ok(res, product);
  } catch (err) {
    next(err);
  }
});

export { router };
