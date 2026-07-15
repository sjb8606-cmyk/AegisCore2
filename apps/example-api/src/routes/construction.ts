import { Router, Request, Response } from 'express';
import { createProject, addCostItem, createChangeOrder, approveChangeOrder, getWipReport, ErrorCode } from '../../../../platform/construction/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  createProject: ['/projects', '/api/construction/projects'],
  addCost: ['/projects/:id/costs', '/api/construction/projects/:id/costs'],
  createCO: ['/projects/:id/change-orders', '/api/construction/projects/:id/change-orders'],
  approveCO: ['/change-orders/:coid/approve', '/api/construction/change-orders/:coid/approve'],
  wip: ['/reports/wip', '/api/construction/reports/wip']
};

router.post(paths.createProject, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const project = await createProject(tenantId, req.body, userId);
    res.status(201).json(project);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.addCost, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const item = await addCostItem(tenantId, req.params.id, req.body, userId);
    res.status(201).json(item);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.createCO, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const co = await createChangeOrder(tenantId, req.params.id, req.body);
    res.status(201).json(co);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.approveCO, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await approveChangeOrder(tenantId, req.params.coid, userId);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get(paths.wip, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const report = await getWipReport(tenantId);
    res.status(200).json(report);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export { router as constructionRouter };
