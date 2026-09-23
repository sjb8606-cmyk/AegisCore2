/**
 * Mountable router: /api/block-store
 * Uses in-process memory store by default for early Option B;
 * swap createMemoryStore() for Postgres adapter when migration V900 is applied.
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createMemoryStore, BlockStoreError } from './src/index';

const router = Router();

// Process-local store (fine for tests / single-node dev). Replace with PG adapter later.
const store = createMemoryStore();

function tenant(req: any): { tenantId: string; userId: string } {
  const auth = req.auth;
  if (!auth?.tenantId) {
    const e: any = new Error('Unauthorized');
    e.statusCode = 401;
    throw e;
  }
  return { tenantId: auth.tenantId, userId: auth.sub || 'unknown' };
}

function mapErr(err: unknown, next: NextFunction) {
  if (err instanceof BlockStoreError) {
    return next(Object.assign(new Error(err.message), { statusCode: err.statusCode, code: err.code }));
  }
  return next(err);
}

router.post('/pages', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = tenant(req);
    const body = z
      .object({
        title: z.string().min(1),
        parentPageId: z.string().uuid().optional().nullable(),
      })
      .parse(req.body);
    const page = await store.createPage({
      tenantId,
      title: body.title,
      parentPageId: body.parentPageId,
      createdBy: userId,
    });
    res.status(201).json(page);
  } catch (err) {
    mapErr(err, next);
  }
});

router.get('/pages/:pageId/tree', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = tenant(req);
    const pageId = z.string().uuid().parse(req.params.pageId);
    const result = await store.getTree(tenantId, pageId);
    res.status(200).json(result);
  } catch (err) {
    mapErr(err, next);
  }
});

router.post('/pages/:pageId/blocks', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = tenant(req);
    const pageId = z.string().uuid().parse(req.params.pageId);
    const body = z
      .object({
        type: z.string(),
        props: z.record(z.unknown()).optional(),
        parentBlockId: z.string().uuid().optional().nullable(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    const block = await store.insertBlock({
      tenantId,
      pageId,
      type: body.type,
      props: body.props,
      parentBlockId: body.parentBlockId,
      sortOrder: body.sortOrder,
    });
    res.status(201).json(block);
  } catch (err) {
    mapErr(err, next);
  }
});

router.patch('/blocks/:blockId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = tenant(req);
    const blockId = z.string().uuid().parse(req.params.blockId);
    const body = z
      .object({
        type: z.string().optional(),
        props: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    const block = await store.updateBlock(tenantId, blockId, body);
    res.status(200).json(block);
  } catch (err) {
    mapErr(err, next);
  }
});

router.delete('/blocks/:blockId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = tenant(req);
    const blockId = z.string().uuid().parse(req.params.blockId);
    await store.deleteBlock(tenantId, blockId);
    res.status(200).json({ id: blockId });
  } catch (err) {
    mapErr(err, next);
  }
});

router.post('/blocks/:blockId/move', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = tenant(req);
    const blockId = z.string().uuid().parse(req.params.blockId);
    const body = z
      .object({
        parentBlockId: z.string().uuid().nullable(),
        sortOrder: z.number().int(),
      })
      .parse(req.body);
    const block = await store.moveBlock(tenantId, blockId, body);
    res.status(200).json(block);
  } catch (err) {
    mapErr(err, next);
  }
});

export { router as blockStoreRouter };
export default router;
