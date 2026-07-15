import { Router, Request, Response } from 'express';
import { createCustomer, createStaff, createService, bookAppointment, checkoutAndProcessPOS, getCustomerLedger, AppError, isValidUuid } from '../../../../platform/salon/src/index';

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
    error: msg || 'An unexpected salon processing error occurred.',
    code: code
  });
}

const paths = {
  customer: ['/customers', '/api/salon/customers'],
  staff: ['/staff', '/api/salon/staff'],
  service: ['/services', '/api/salon/services'],
  book: ['/appointments', '/api/salon/appointments'],
  checkout: ['/appointments/:id/checkout', '/api/salon/appointments/:id/checkout'],
  ledger: ['/customers/:id/ledger', '/api/salon/customers/:id/ledger']
};

router.post(paths.customer, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createCustomer(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.staff, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createStaff(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.service, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createService(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.book, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await bookAppointment(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.checkout, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const appointmentId = req.params.id;
    if (!isValidUuid(appointmentId)) {
      throw new AppError(`Invalid Appointment ID format: '${appointmentId}'`, 'BAD_REQUEST');
    }
    const result = await checkoutAndProcessPOS(tenantId, appointmentId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const customerId = req.params.id;
    if (!isValidUuid(customerId)) {
      throw new AppError(`Invalid Customer ID format: '${customerId}'`, 'BAD_REQUEST');
    }
    const result = await getCustomerLedger(tenantId, customerId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as salonRouter, router as 'salonRouter' };
