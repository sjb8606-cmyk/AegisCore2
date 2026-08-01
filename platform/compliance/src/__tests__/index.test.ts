import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../audit/src/index', () => ({
  emit: vi.fn(),
}));
vi.mock('../../../queues/src/index', () => ({
  enqueue: vi.fn(),
}));
vi.mock('../../../utils/src/index', () => ({
  loadConfig: vi.fn(),
}));

import { submitDataRequest } from '../index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { emit as auditEmit } from '../../../audit/src/index';
import { enqueue } from '../../../queues/src/index';
import { loadConfig } from '../../../utils/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/compliance-data-requests';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({
    enabled: true,
    limits: { requestResponseDays: 30 },
    queueUrl: QUEUE_URL,
  });
});

describe('submitDataRequest', () => {
  it('records the request, audits it, and enqueues a real processing job', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: REQUEST_ID, tenant_id: TENANT_ID, user_id: USER_ID, request_type: 'gdpr_export' },
    ]);

    const result = await submitDataRequest(TENANT_ID, USER_ID, 'gdpr_export');

    expect(result.id).toBe(REQUEST_ID);
    expect(auditEmit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, action: 'compliance.gdpr_export' })
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
    const enqueueCall = (enqueue as any).mock.calls[0][0];
    expect(enqueueCall.queueUrl).toBe(QUEUE_URL);
    expect(enqueueCall.deduplicationId).toBe(REQUEST_ID);

    const body = JSON.parse(enqueueCall.body);
    expect(body.dataRequestId).toBe(REQUEST_ID);
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.userId).toBe(USER_ID);
    expect(body.requestType).toBe('gdpr_export');
  });

  it('throws when compliance is disabled', async () => {
    (loadConfig as any).mockReturnValue({
      enabled: false,
      limits: { requestResponseDays: 30 },
      queueUrl: QUEUE_URL,
    });

    await expect(submitDataRequest(TENANT_ID, USER_ID, 'gdpr_deletion')).rejects.toThrow(
      'Compliance feature disabled'
    );

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue if the DB insert fails to return a row', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    await expect(submitDataRequest(TENANT_ID, USER_ID, 'gdpr_export')).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
