import { Router, Request, Response } from 'express';
import { createProperty, createUnit, createTenant, createLease, recordRentPayment, getUnitLedger, AppError, isValidUuid } from '../../../../platform/property-management/src/index';

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
  const status = code === 'FORBIDDEN' ? 403 : (code === 'CONFLICT' ? 409 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500)));
  
  res.status(status).json({ 
    error: msg || 'An unexpected property management error occurred.',
    code: code
  });
}

const paths = {
  property: ['/properties', '/api/property-management/properties'],
  unit: ['/units', '/api/property-management/units'],
  tenant: ['/tenants', '/api/property-management/tenants'],
  lease: ['/leases', '/api/property-management/leases'],
  payment: ['/leases/:id/payments', '/api/property-management/leases/:id/payments'],
  ledger: ['/units/:id/ledger', '/api/property-management/units/:id/ledger']
};

router.post(paths.property, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createProperty(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.unit, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createUnit(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.tenant, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createTenant(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.lease, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createLease(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.payment, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const leaseId = req.params.id;
    if (!isValidUuid(leaseId)) {
      throw new AppError(`Invalid Lease ID format: '${leaseId}'`, 'BAD_REQUEST');
    }
    const result = await recordRentPayment(tenantId, leaseId, req.body.amount_cents);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const unitId = req.params.id;
    if (!isValidUuid(unitId)) {
      throw new AppError(`Invalid Unit ID format: '${unitId}'`, 'BAD_REQUEST');
    }
    const result = await getUnitLedger(tenantId, unitId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as propertyManagementRouter, router as 'property-managementRouter' };
