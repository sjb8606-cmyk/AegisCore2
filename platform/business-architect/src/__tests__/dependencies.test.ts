import { describe, expect, it } from 'vitest';
import { affectedStages, artifactTypesAffectedBy } from '../dependencies';

describe('Business Architect dependency propagation',()=>{
  it('propagates an upstream change downstream',()=>{
    const affected=affectedStages('PRICING');
    expect(affected).toContain('COSTS');
    expect(affected).toContain('FINANCIALS');
    expect(affected).toContain('PLAN');
  });
  it('does not mark unrelated upstream stages affected',()=>{
    expect(affectedStages('PRICING')).not.toContain('IDEA');
  });
  it('marks generated artifacts stale targets from upstream changes',()=>{
    expect(artifactTypesAffectedBy('COSTS')).toContain('BUSINESS_PLAN');
  });
});
