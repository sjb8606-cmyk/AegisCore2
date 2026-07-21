import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createTenantUser, inviteUser, acceptInvitation, removeUser, ErrorCode } from '../../../../platform/multitenancy-ui/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createUser: ['/users', '/api/multitenancy-ui/users'],
  invite: ['/invitations', '/api/multitenancy-ui/invitations'],
  accept: ['/invitations/accept', '/api/multitenancy-ui/invitations/accept'],
  remove: ['/users/:id', '/api/multitenancy-ui/users/:id']
};

router.post(paths.createUser, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const user = await createTenantUser(tenantId, req.body);
    res.status(201).json(user);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.invite, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const invitation = await inviteUser(tenantId, userId, req.body);
    res.status(201).json(invitation);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.accept, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await acceptInvitation(tenantId, req.body.token, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.delete(paths.remove, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await removeUser(tenantId, req.params.id);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as multitenancyUiRouter };
