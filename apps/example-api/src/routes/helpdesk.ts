import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createAgent, createTicket, addMessage, autoAssignTicket, ErrorCode } from '../../../../platform/helpdesk/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createAgent: ['/agents', '/api/helpdesk/agents'],
  createTicket: ['/tickets', '/api/helpdesk/tickets'],
  addMessage: ['/tickets/:id/messages', '/api/helpdesk/tickets/:id/messages'],
  assign: ['/tickets/:id/assign', '/api/helpdesk/tickets/:id/assign']
};

router.post(paths.createAgent, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const agent = await createAgent(tenantId, req.body);
    res.status(201).json(agent);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createTicket, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const ticket = await createTicket(tenantId, req.body, userId);
    res.status(201).json(ticket);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.addMessage, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const msg = await addMessage(tenantId, req.params.id, req.body.body, userId, req.body.authorEmail, req.body.isInternal);
    res.status(201).json(msg);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.assign, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const assignment = await autoAssignTicket(tenantId, req.params.id);
    res.status(200).json(assignment);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as helpdeskRouter };
