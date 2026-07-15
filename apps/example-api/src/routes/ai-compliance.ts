import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { AiComplianceService } from '../../../../platform/ai-compliance/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/checks', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiComplianceService.runComplianceCheck(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/reports', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiComplianceService.generateAuditReport(req.auth.tenantId, req.body.reportType);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/reports', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiComplianceService.fetchReports(req.auth.tenantId);
    return ok(res, { reports: result });
  } catch (err) {
    next(err);
  }
});

export { router as aiComplianceRouter };
