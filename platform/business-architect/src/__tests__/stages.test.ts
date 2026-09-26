import { describe, expect, it } from 'vitest';
import { BUSINESS_STAGES } from '../schemas';
import { nextStage, previousStage, canCompleteStage } from '../stages';

describe('Business Architect stages',()=>{
  it('keeps the canonical stage order',()=>{
    expect(nextStage('IDEA')).toBe('CUSTOMER_PROBLEM');
    expect(previousStage('CUSTOMER_PROBLEM')).toBe('IDEA');
    expect(nextStage('OPERATE')).toBeNull();
  });
  it('does not advance from prose alone',()=>{
    expect(canCompleteStage('IDEA',{})).toBe(false);
    expect(canCompleteStage('IDEA',{idea:{}})).toBe(false);
    expect(canCompleteStage('IDEA',{idea:{problem:'x'}})).toBe(true);
  });
  it('contains all planned stages',()=>expect(BUSINESS_STAGES).toHaveLength(16));
});
