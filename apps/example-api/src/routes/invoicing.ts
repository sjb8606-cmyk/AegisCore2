import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { InvoicingService } from '../../../../platform/invoicing/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/invoices', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth.sub;
    const result = await InvoicingService.createInvoice(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/invoices/:id/pay', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth.sub;
    const result = await InvoicingService.recordPayment(req.auth.tenantId, req.params.id, req.body, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/invoices/:id', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await InvoicingService.getInvoice(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.delete('/invoices/:id', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth.sub;
    await InvoicingService.voidInvoice(req.auth.tenantId, req.params.id, userId);
    return ok(res, { success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await InvoicingService.listInvoices(req.auth.tenantId);
    return ok(res, { invoices: result });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await InvoicingService.fetchSummary(req.auth.tenantId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as invoicingRouter };
