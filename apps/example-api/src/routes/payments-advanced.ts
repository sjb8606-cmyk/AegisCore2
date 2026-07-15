import { Router, Request, Response } from 'express';
import { savePaymentMethod, initiateDunning, calculateTax, ErrorCode } from '../../../../platform/payments-advanced/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
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
