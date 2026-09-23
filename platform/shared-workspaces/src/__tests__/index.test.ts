import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryWorkspaceDb,
  createWorkspace,
  listWorkspaces,
  deleteWorkspace,
  validateCreateInput,
  encodeDescription,
  decodeDescription,
  WorkspaceError,
} from '../index';

const T = '11111111-1111-1111-1111-111111111111';
const U = '22222222-2222-2222-2222-222222222222';

describe('shared-workspaces', () => {
  let db: ReturnType<typeof createMemoryWorkspaceDb>;

  beforeEach(() => {
    db = createMemoryWorkspaceDb();
  });

  it('validateCreateInput accepts name', () => {
    const v = validateCreateInput({ name: 'Plant A' });
    expect(v.name).toBe('Plant A');
  });

  it('validateCreateInput rejects empty name', () => {
    expect(() => validateCreateInput({ name: '' })).toThrow(WorkspaceError);
  });

  it('encode/decode rootPageId in description envelope', () => {
    const enc = encodeDescription('hello', '33333333-3333-4333-8333-333333333333');
    const dec = decodeDescription(enc);
    expect(dec.text).toBe('hello');
    expect(dec.rootPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('create + list + delete', async () => {
    const ws = await createWorkspace(db, T, U, {
      name: 'Bay line',
      description: 'Morning shift',
      memberIds: [],
    });
    expect(ws.name).toBe('Bay line');
    expect(ws.userId).toBe(U);

    const list = await listWorkspaces(db, T, { limit: 10 });
    expect(list).toHaveLength(1);

    await deleteWorkspace(db, T, ws.id, U);
    const after = await listWorkspaces(db, T, { limit: 10 });
    expect(after).toHaveLength(0);
  });

  it('delete by non-owner fails', async () => {
    const ws = await createWorkspace(db, T, U, { name: 'X' });
    await expect(
      deleteWorkspace(db, T, ws.id, '99999999-9999-4999-8999-999999999999'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('create with rootPageId', async () => {
    const pageId = '44444444-4444-4444-8444-444444444444';
    const ws = await createWorkspace(db, T, U, { name: 'With page', rootPageId: pageId });
    expect(ws.rootPageId).toBe(pageId);
  });
});
