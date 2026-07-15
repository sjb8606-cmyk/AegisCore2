import { Router, Request, Response } from 'express';
import { createAgentDefinition, initiateRun, resolveApproval, getRunDetails, ErrorCode } from '../../../../platform/ai-agents/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  createDef: ['/definitions', '/api/ai-agents/definitions'],
  initiate: ['/runs', '/api/ai-agents/runs'],
  getRun: ['/runs/:id', '/api/ai-agents/runs/:id'],
  resolve: ['/approvals/:id/resolve', '/api/ai-agents/approvals/:id/resolve']
};

router.post(paths.createDef, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const agent = await createAgentDefinition(tenantId, req.body);
    res.status(201).json(agent);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.initiate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const run = await initiateRun(tenantId, req.body.agentId, req.body.input, userId);
    res.status(201).json(run);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getRun, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const run = await getRunDetails(tenantId, req.params.id);
    res.status(200).json(run);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.resolve, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await resolveApproval(tenantId, req.params.id, req.body.approved, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as aiAgentsRouter };
