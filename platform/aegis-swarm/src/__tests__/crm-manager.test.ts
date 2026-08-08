import { canTransition, ALLOWED_TRANSITIONS } from '../employees/crm-manager';
import { LeadStage } from '../lib/crm-store';

// Note: addLead()/moveStage() on CrmManagerBot call the real
// crm-store.ts module, which needs a live Postgres connection not
// available in this sandbox. Only the pure, real state-machine logic
// is unit-tested here — same honest limitation as every DB-touching
// piece tonight. The store-touching bot methods need a real
// integration test run against a live Codespace DB.

describe('canTransition (pure, real pipeline state machine)', () => {
  it('allows the real first step: new -> contacted', () => {
    expect(canTransition('new', 'contacted')).toBe(true);
  });

  it('rejects skipping stages: new -> won', () => {
    expect(canTransition('new', 'won')).toBe(false);
  });

  it('rejects reopening a terminal state: won -> contacted', () => {
    expect(canTransition('won', 'contacted')).toBe(false);
  });

  it('rejects reopening the other terminal state: lost -> new', () => {
    expect(canTransition('lost', 'new')).toBe(false);
  });

  it('allows the real final step: proposal_sent -> won', () => {
    expect(canTransition('proposal_sent', 'won')).toBe(true);
  });

  it('allows the real escape hatch from any active stage to lost', () => {
    const activeStages: LeadStage[] = ['new', 'contacted', 'qualified', 'proposal_sent'];
    for (const stage of activeStages) {
      expect(canTransition(stage, 'lost')).toBe(true);
    }
  });

  it('confirms both terminal states have zero real allowed transitions', () => {
    expect(ALLOWED_TRANSITIONS.won).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.lost).toHaveLength(0);
  });
});
