import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createContact, addTag, mergeContacts, getContactLedger } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_ID = '44444444-4444-4444-4444-444444444444';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createContact', () => {
  it('blocks when the module is disabled', async () => {
    mockConfig({ enabled: false, tiers: {} });
    await expect(createContact(TENANT_ID, { type: 'person' })).rejects.toThrow('Contacts module is disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects an invalid type via schema validation', async () => {
    await expect(createContact(TENANT_ID, { type: 'not-a-real-type' })).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('creates a contact and returns the inserted row', async () => {
    const row = { id: CONTACT_ID, type: 'person', status: 'active' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await createContact(TENANT_ID, { type: 'person', first_name: 'Sam' });
    expect(result).toEqual(row);
  });
});

describe('addTag', () => {
  it('blocks when the tagging tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { tagging: false } });
    await expect(addTag(TENANT_ID, CONTACT_ID, { tag: 'vip' })).rejects.toThrow('Contacts tagging tier is disabled');
  });

  it('rejects a malformed contactId before touching the database', async () => {
    mockConfig({ enabled: true, tiers: { tagging: true } });
    await expect(addTag(TENANT_ID, 'not-a-uuid', { tag: 'vip' })).rejects.toThrow('Invalid Contact ID format.');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('returns a duplicate-tag status when ON CONFLICT DO NOTHING yields no row', async () => {
    mockConfig({ enabled: true, tiers: { tagging: true } });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    const result = await addTag(TENANT_ID, CONTACT_ID, { tag: 'vip' });
    expect(result).toEqual({ status: 'ignored_duplicate_tag' });
  });

  it('returns the inserted tag row on success', async () => {
    mockConfig({ enabled: true, tiers: { tagging: true } });
    const row = { id: 'tag-1', tag: 'vip' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await addTag(TENANT_ID, CONTACT_ID, { tag: 'vip' });
    expect(result).toEqual(row);
  });
});

describe('mergeContacts', () => {
  it('blocks when the contactMerging tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: false } });
    await expect(mergeContacts(TENANT_ID, CONTACT_ID, TARGET_ID, USER_ID)).rejects.toThrow(
      'Contacts merging tier is disabled'
    );
  });

  it('rejects malformed source or target IDs', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: true } });
    await expect(mergeContacts(TENANT_ID, 'not-a-uuid', TARGET_ID, USER_ID)).rejects.toThrow(
      'Invalid ID formats (Source or Target).'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when either contact does not exist', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: true } });
    (withTenantQuery as any).mockResolvedValueOnce([{ id: CONTACT_ID }]).mockResolvedValueOnce([]);
    await expect(mergeContacts(TENANT_ID, CONTACT_ID, TARGET_ID, USER_ID)).rejects.toThrow(
      'Source or Target contact not found.'
    );
  });

  it('rejects merging an already-merged source contact', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: CONTACT_ID, status: 'merged' }])
      .mockResolvedValueOnce([{ id: TARGET_ID, status: 'active' }]);
    await expect(mergeContacts(TENANT_ID, CONTACT_ID, TARGET_ID, USER_ID)).rejects.toThrow(
      'Source contact is already merged.'
    );
  });

  // BUG — documented, not hidden. There is no check anywhere in this function
  // that sourceId !== targetId. Both pass isValidUuid, both resolve to the
  // same row, and the function proceeds to set that contact's own
  // status='merged' with merged_into_id pointing at itself — silently
  // corrupting the contact instead of rejecting a nonsensical self-merge.
  it('BUG: does not reject merging a contact into itself (sourceId === targetId)', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: true } });
    const selfContact = { id: CONTACT_ID, status: 'active', first_name: 'Sam', last_name: 'X' };
    (withTenantQuery as any)
      .mockResolvedValueOnce([selfContact])
      .mockResolvedValueOnce([selfContact])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...selfContact, status: 'merged', merged_into_id: CONTACT_ID }])
      .mockResolvedValueOnce([]);

    const result = await mergeContacts(TENANT_ID, CONTACT_ID, CONTACT_ID, USER_ID);

    expect(result.mergedInto).toBe(CONTACT_ID);
    expect(result.source.merged_into_id).toBe(CONTACT_ID);
    // TODO(contacts bug): add `if (sourceId === targetId) throw new AppError(...)` before any queries run.
  });

  it('merges tags and marks the source as merged on a valid pair', async () => {
    mockConfig({ enabled: true, tiers: { contactMerging: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: CONTACT_ID, status: 'active', first_name: 'A', last_name: 'B' }])
      .mockResolvedValueOnce([{ id: TARGET_ID, status: 'active' }])
      .mockResolvedValueOnce([{ tag: 'vip' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: CONTACT_ID, status: 'merged' }])
      .mockResolvedValueOnce([]);

    const result = await mergeContacts(TENANT_ID, CONTACT_ID, TARGET_ID, USER_ID);

    expect(result.success).toBe(true);
    expect(result.mergedInto).toBe(TARGET_ID);
    expect(result.source.status).toBe('merged');
  });
});

describe('getContactLedger', () => {
  it('rejects a malformed contactId', async () => {
    await expect(getContactLedger(TENANT_ID, 'not-a-uuid')).rejects.toThrow('Invalid Contact ID format.');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the contact does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(getContactLedger(TENANT_ID, CONTACT_ID)).rejects.toThrow('Contact not found.');
  });

  it('attaches tags and activities to the contact', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: CONTACT_ID, first_name: 'Sam' }])
      .mockResolvedValueOnce([{ tag: 'vip' }])
      .mockResolvedValueOnce([{ activity_type: 'status_change' }]);

    const result = await getContactLedger(TENANT_ID, CONTACT_ID);

    expect(result.tags).toEqual([{ tag: 'vip' }]);
    expect(result.activities).toEqual([{ activity_type: 'status_change' }]);
  });
});
