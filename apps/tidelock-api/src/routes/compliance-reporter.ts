import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { ComplianceReporterService } from '../../../../platform/fisheries/compliance-reporter/src/index';

const router = Router();

router.post('/catch', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const report = await ComplianceReporterService.generateCatchReport(tenantId, req.auth.sub, req.body);
    res.status(201).json(report);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const report = await ComplianceReporterService.getReport(tenantId, req.params.id);
    res.status(200).json(report);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const reports = await ComplianceReporterService.listReports(tenantId);
    res.status(200).json(reports);
  } catch (err) { next(err); }
});

export default router;
