import { Router, Request, Response } from 'express';
import { 
  createProject, 
  createTask, 
  getProjectProgress, 
  getGanttData, 
  ErrorCode 
} from '../../../../platform/projects/src/index';

const router = Router();

function extractTenantAndUser(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) {
    throw { message: 'Missing x-tenant-id header required for operation', code: (ErrorCode as any).BAD_REQUEST };
  }
  return { tenantId, userId };
}

const paths = {
  createProject: ['/', '/projects', '/api/projects'],
  createTask: ['/:projectId/tasks', '/projects/:projectId/tasks', '/api/projects/:projectId/tasks'],
  getProgress: ['/:projectId/progress', '/projects/:projectId/progress', '/api/projects/:projectId/progress'],
  getGantt: ['/:projectId/gantt', '/projects/:projectId/gantt', '/api/projects/:projectId/gantt']
};

router.post(paths.createProject, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractTenantAndUser(req);
    const project = await createProject(tenantId, userId, req.body);
    res.status(201).json(project);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).FORBIDDEN ? 403 : 
                       error.code === (ErrorCode as any).INSUFFICIENT_STORAGE ? 507 : 400;
    res.status(statusCode).json({ error: error.message || 'Internal database error' });
  }
});

router.post(paths.createTask, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractTenantAndUser(req);
    const { projectId } = req.params;
    const task = await createTask(tenantId, projectId, userId, req.body);
    res.status(201).json(task);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).FORBIDDEN ? 403 : 
                       error.code === (ErrorCode as any).INSUFFICIENT_STORAGE ? 507 : 400;
    res.status(statusCode).json({ error: error.message || 'Internal task failure' });
  }
});

router.get(paths.getProgress, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractTenantAndUser(req);
    const { projectId } = req.params;
    const progress = await getProjectProgress(tenantId, projectId);
    res.status(200).json(progress);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to resolve progress ratio' });
  }
});

router.get(paths.getGantt, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractTenantAndUser(req);
    const { projectId } = req.params;
    const gantt = await getGanttData(tenantId, projectId);
    res.status(200).json(gantt);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).FORBIDDEN ? 403 : 500;
    res.status(statusCode).json({ error: error.message || 'Gantt execution error' });
  }
});

export { router as projectsRouter };
