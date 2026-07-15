import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export interface ProjectInput {
  name: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  budgetCents?: number;
}

export interface TaskInput {
  title: string;
  description?: string;
  assignedTo?: string;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  dependsOn?: string[];
  customFields?: Record<string, any>;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'projects.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: { milestones: true, timeTracking: true, dependencies: true, ganttView: true },
    limits: { projectCount: 5, tasksPerProject: 50 }
  };
}

export async function createProject(tenantId: string, userId: string, data: ProjectInput) {
  const config = loadConfig();
  if (!config.enabled) {
    throw new AppError('Projects feature is disabled', ErrorCode.FORBIDDEN);
  }

  // Direct array return check
  const countResult = await withTenantQuery(
    "SELECT COUNT(*) as count FROM projects WHERE tenant_id = $1 AND is_deleted = false",
    [tenantId],
    tenantId
  );
  
  const currentCount = parseInt(countResult[0]?.count || '0', 10);
  if (currentCount >= config.limits.projectCount) {
    throw new AppError('Project tier capacity limit reached', ErrorCode.FORBIDDEN);
  }

  const projectId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO projects (id, tenant_id, name, description, budget_cents, start_date, due_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
  const params = [
    projectId,
    tenantId,
    data.name,
    data.description || null,
    data.budgetCents || 0,
    data.startDate || null,
    data.dueDate || null
  ];

  const result = await withTenantQuery(insertQuery, params, tenantId);
  return result[0];
}

export async function createTask(tenantId: string, projectId: string, userId: string, data: TaskInput) {
  const config = loadConfig();
  if (!config.enabled) {
    throw new AppError('Projects feature is disabled', ErrorCode.FORBIDDEN);
  }

  // Direct array return check
  const countResult = await withTenantQuery(
    "SELECT COUNT(*) as count FROM tasks WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false",
    [projectId, tenantId],
    tenantId
  );
  const currentCount = parseInt(countResult[0]?.count || '0', 10);
  if (currentCount >= config.limits.tasksPerProject) {
    throw new AppError('Task limit per project reached', ErrorCode.FORBIDDEN);
  }

  const dependsOnArray = data.dependsOn || [];
  if (dependsOnArray.length > 0 && !config.tiers.dependencies) {
    throw new AppError('Task dependencies are disabled on this billing tier', ErrorCode.FORBIDDEN);
  }

  if (dependsOnArray.length > 0) {
    const hasCycle = await detectCircularDependency(tenantId, projectId, dependsOnArray, null);
    if (hasCycle) {
      throw new AppError('Circular dependency detected', ErrorCode.BAD_REQUEST);
    }
  }

  const taskId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO tasks (id, tenant_id, project_id, title, description, assigned_to, start_date, due_date, estimated_hours, depends_on, custom_fields)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
  `;
  const params = [
    taskId,
    tenantId,
    projectId,
    data.title,
    data.description || null,
    data.assignedTo ? parseUserId(data.assignedTo) : null,
    data.startDate || null,
    data.dueDate || null,
    data.estimatedHours || 0.00,
    dependsOnArray,
    JSON.stringify(data.customFields || {})
  ];

  const result = await withTenantQuery(insertQuery, params, tenantId);
  return result[0];
}

export async function getProjectProgress(tenantId: string, projectId: string) {
  const result = await withTenantQuery(
    "SELECT status, count(*) as qty FROM tasks WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false GROUP BY status",
    [projectId, tenantId],
    tenantId
  );

  let completed = 0;
  let total = 0;
  result.forEach((row: any) => {
    const qty = parseInt(row.qty, 10);
    total += qty;
    if (row.status === 'completed' || row.status === 'done') {
      completed += qty;
    }
  });

  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percentComplete, completed, total };
}

export async function getGanttData(tenantId: string, projectId: string) {
  const config = loadConfig();
  if (!config.tiers.ganttView) {
    throw new AppError('Gantt View is disabled on this billing tier', ErrorCode.FORBIDDEN);
  }

  const result = await withTenantQuery(
    "SELECT id, title, start_date as \"startDate\", due_date as \"dueDate\", depends_on as \"dependsOn\", status FROM tasks WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false ORDER BY start_date ASC",
    [projectId, tenantId],
    tenantId
  );
  return result;
}

async function detectCircularDependency(
  tenantId: string, 
  projectId: string, 
  proposedDependencies: string[], 
  currentTaskId: string | null
): Promise<boolean> {
  const result = await withTenantQuery(
    "SELECT id, depends_on FROM tasks WHERE project_id = $1 AND tenant_id = $2 AND is_deleted = false",
    [projectId, tenantId],
    tenantId
  );

  const adjList: Record<string, string[]> = {};
  result.forEach((task: any) => {
    adjList[task.id] = task.depends_on || [];
  });

  if (currentTaskId) {
    adjList[currentTaskId] = proposedDependencies;
  } else {
    proposedDependencies.forEach(depId => {
      if (!adjList[depId]) adjList[depId] = [];
    });
  }

  const visited: Record<string, boolean> = {};
  const recStack: Record<string, boolean> = {};

  const dfs = (node: string): boolean => {
    if (recStack[node]) return true;
    if (visited[node]) return false;

    visited[node] = true;
    recStack[node] = true;

    const neighbors = adjList[node] || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) return true;
    }

    recStack[node] = false;
    return false;
  };

  for (const node of Object.keys(adjList)) {
    if (dfs(node)) return true;
  }

  return false;
}
