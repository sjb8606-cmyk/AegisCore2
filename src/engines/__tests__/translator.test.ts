import { describe, it, expect } from 'vitest';
import { translate, translateSafe } from '../translator';

describe('translator', () => {
  it('translate known event types', () => {
    expect(translate('new_receipt')).toMatch(/verified decision/i);
    expect(translate('replay_mismatch')).toMatch(/Investigation required/i);
  });

  it('translate throws on unknown', () => {
    expect(() => translate('not_a_real_event' as any)).toThrow(/Unknown event_type/);
  });

  it('translateSafe never throws', () => {
    expect(translateSafe('nope')).toMatch(/Unknown/);
  });
});
