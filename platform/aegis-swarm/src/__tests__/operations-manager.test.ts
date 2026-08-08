import { BotSpecification } from '@platform/bot-registry';
import { OperationsManagerBot, findBottleneck, ProcessStep } from '../employees/operations-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-36',
    role: 'Test Operations Manager used to verify real Theory of Constraints logic.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Operations Manager used to verify real bottleneck detection.',
    permissionScope: ['read:process-data'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const STEPS: ProcessStep[] = [
  { name: 'A', capacityPerHour: 100 },
  { name: 'B', capacityPerHour: 60 },
  { name: 'C', capacityPerHour: 90 },
];

describe('findBottleneck (pure real Theory of Constraints)', () => {
  it('identifies the real slowest step as the bottleneck', () => {
    const result = findBottleneck(STEPS);
    expect(result.bottleneck).toBe('B');
  });

  it('reports real system throughput equal to the bottleneck, not the faster steps', () => {
    const result = findBottleneck(STEPS);
    expect(result.systemThroughputPerHour).toBe(60);
  });

  it('correctly identifies a different real bottleneck when the numbers change', () => {
    const result = findBottleneck([
      { name: 'X', capacityPerHour: 30 },
      { name: 'Y', capacityPerHour: 50 },
    ]);
    expect(result.bottleneck).toBe('X');
    expect(result.systemThroughputPerHour).toBe(30);
  });
});

describe('OperationsManagerBot', () => {
  describe('analyzeProcess', () => {
    it('produces a real bottleneck analysis', async () => {
      const bot = new OperationsManagerBot(makeSpec());
      const result = await bot.analyzeProcess(STEPS);

      expect(result.bottleneck).toBe('B');
      expect(result.systemThroughputPerHour).toBe(60);
    });

    it('blocks analysis without read:process-data permission', async () => {
      const bot = new OperationsManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.analyzeProcess(STEPS)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
