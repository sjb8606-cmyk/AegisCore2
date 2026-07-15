import { loadConfig } from '../../utils/src/index';
import { z } from 'zod';

const SafetyConfigSchema = z.object({
  hardBoundaries: z.array(z.string()),
  layer2Response: z.string()
});

const KEYWORD_DICTIONARY: Record<string, string[]> = {
  medical: ['doctor', 'diagnosis', 'pain', 'medicine', 'hospital', 'cure', 'sick'],
  financial_advice: ['stocks', 'invest', 'buy', 'sell', 'crypto', 'portfolio', 'rich'],
  therapy: ['depressed', 'anxiety', 'mental health', 'suicide', 'hurt myself'],
  legal_advice: ['sue', 'lawyer', 'legal', 'court', 'contract', 'lawsuit']
};

export function scanForBoundaries(message: string, personaBoundaries: any) {
  const config = loadConfig('delight-safety', SafetyConfigSchema);
  const lowerMsg = message.toLowerCase();

  for (const category of config.hardBoundaries) {
    const keywords = KEYWORD_DICTIONARY[category] || [];
    const hit = keywords.find(word => lowerMsg.includes(word));

    if (hit) {
      return {
        hit: true,
        category,
        // CRASH GUARD: Use persona response, or fallback to Layer 2 if missing
        layer1: personaBoundaries?.layer_1_response || config.layer2Response,
        layer2: config.layer2Response
      };
    }
  }
  return { hit: false };
}
