import { Router, Request, Response } from 'express';
import { createDeprecationRule, logUsageEvent, evaluateEnforcementGate, getDeprecationLedger, AppError, isValidUuid } from '../../../../platform/deprecation-manager/src/index';

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
  const status = code === 'FORBIDDEN' ? 403 : (code === 'GONE' ? 410 : (code === 'BAD_REQUEST' ? 400 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected deprecation exception occurred.',
    code: code
  });
}

const paths = {
  rule: ['/rules', '/api/deprecation-manager/rules'],
  log: ['/usage/log', '/api/deprecation-manager/usage/log'],
  evaluate: ['/evaluate', '/api/deprecation-manager/evaluate'],
  ledger: ['/rules/:id/ledger', '/api/deprecation-manager/rules/:id/ledger']
};

router.post(paths.rule, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createDeprecationRule(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.log, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await logUsageEvent(tenantId, req.body.rule_id, req.body.fingerprint, req.body.size_bytes);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.evaluate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const surface = String(req.query.surface);
    const result = await evaluateEnforcementGate(tenantId, surface);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const ruleId = req.params.id;
    if (!isValidUuid(ruleId)) {
      throw new AppError(`Invalid Rule ID format: '${ruleId}'`, 'BAD_REQUEST');
    }
    const result = await getDeprecationLedger(tenantId, ruleId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as deprecationManagerRouter, router as 'deprecation-managerRouter' };
