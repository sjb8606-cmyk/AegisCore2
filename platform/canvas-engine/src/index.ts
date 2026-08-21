/**
 * platform/canvas-engine — design documents + mock export.
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
const logger = getLogger('canvas-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxNodes: z.number().default(500),
});

export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

export interface CanvasDocument {
  id: string;
  tenantId: string;
  name: string;
  nodes: CanvasNode[];
  updatedAt: string;
}

const docs = new Map<string, CanvasDocument>();

export function __resetCanvasEngineStore(): void {
  docs.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('canvas-engine', ConfigSchema);
}

export async function createDocument(
  tenantId: string,
  actorId: string,
  input: { name: string; nodes?: CanvasNode[] },
): Promise<CanvasDocument> {
  return runCrudOperation({
    configName: 'canvas-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.name?.trim()) throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      const doc: CanvasDocument = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        nodes: input.nodes || [],
        updatedAt: new Date().toISOString(),
      };
      docs.set(doc.id, doc);
      return doc;
    },
    auditAction: 'data.created',
    auditResource: 'canvas_document',
    meterEventType: 'api_call',
  });
}

export async function updateDocument(
  tenantId: string,
  actorId: string,
  docId: string,
  input: { name?: string; nodes?: CanvasNode[] },
): Promise<CanvasDocument> {
  return runCrudOperation({
    configName: 'canvas-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const doc = docs.get(docId);
      if (!doc || doc.tenantId !== tenantId) {
        throw new AppError('Document not found', ErrorCode.NOT_FOUND);
      }
      if (input.nodes && input.nodes.length > config.maxNodes) {
        throw new AppError('Too many nodes', ErrorCode.BAD_REQUEST);
      }
      if (input.name) doc.name = input.name;
      if (input.nodes) doc.nodes = input.nodes;
      doc.updatedAt = new Date().toISOString();
      docs.set(docId, doc);
      return doc;
    },
    auditAction: 'data.updated',
    auditResource: 'canvas_document',
    meterEventType: 'api_call',
  });
}

export async function exportDocument(
  tenantId: string,
  actorId: string,
  docId: string,
  format: 'png' | 'svg' | 'json' = 'png',
): Promise<{ url: string; format: string }> {
  return runCrudOperation({
    configName: 'canvas-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const doc = docs.get(docId);
      if (!doc || doc.tenantId !== tenantId) {
        throw new AppError('Document not found', ErrorCode.NOT_FOUND);
      }
      logger.info({ docId, format }, 'Canvas exported');
      return {
        url: 'https://cdn.mock/canvas/' + docId.slice(0, 8) + '.' + format,
        format,
      };
    },
    auditAction: 'data.read',
    auditResource: 'canvas_export',
    meterEventType: 'api_call',
  });
}

export function listTemplates(): { id: string; name: string }[] {
  return [
    { id: 'blank', name: 'Blank' },
    { id: 'landing', name: 'Landing page' },
    { id: 'dashboard', name: 'Dashboard' },
  ];
}

export async function getDocument(
  tenantId: string,
  docId: string,
): Promise<CanvasDocument | null> {
  const d = docs.get(docId);
  if (!d || d.tenantId !== tenantId) return null;
  return d;
}
