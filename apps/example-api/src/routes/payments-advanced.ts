import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { savePaymentMethod, initiateDunning, calculateTax, ErrorCode } from '../../../../platform/payments-advanced/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  savePM: ['/methods', '/api/payments-advanced/methods'],
  dunning: ['/dunning/initiate', '/api/payments-advanced/dunning/initiate'],
  tax: ['/tax/calculate', '/api/payments-advanced/tax/calculate']
};

router.post(paths.savePM, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const method = await savePaymentMethod(tenantId, userId, req.body.stripePaymentMethodId);
    res.status(201).json(method);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.dunning, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const record = await initiateDunning(tenantId, req.body.payment_id, req.body.amount_cents, req.body.subscription_id);
    res.status(201).json(record);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.tax, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tax = await calculateTax(tenantId, req.body.payment_id, req.body.amount_cents, req.body.jurisdiction);
    res.status(201).json(tax);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as paymentsAdvancedRouter };
