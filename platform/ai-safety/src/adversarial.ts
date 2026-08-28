export interface AdversarialResult {
  detected: boolean;
  reason: string;
  patterns: string[];
  score: number;
}

const ADVERSARIAL_PATTERNS = [
  { name: 'ignore_instructions', pattern: /ignore\s+(previous|above|all|prior|system)\s+(instructions?|prompts?|rules?|constraints?)/i, weight: 40 },
  { name: 'jailbreak_dan', pattern: /\bDAN\b|do anything now|jailbreak|bypass\s+(safety|filter|restriction|guardrail)/i, weight: 50 },
  { name: 'extract_system_prompt', pattern: /repeat\s+(your\s+)?(system|initial|original)\s+prompt|print\s+your\s+(instructions?|prompt)/i, weight: 45 },
  { name: 'output_injection', pattern: /<\/?script|javascript:|onerror=|onload=|\{\{.*?\}\}|<%.*?%>/i, weight: 60 },
  { name: 'goal_hijack', pattern: /\b(your\s+)?new\s+goal\s+is\b|change\s+your\s+goal|goal\s+is\s+now/i, weight: 45 },
  { name: 'token_smuggling', pattern: /\[\/?INST\]|<\|.*?\|>|\bunrestricted\s+(AI|assistant|mode)\b/i, weight: 50 },
];

/** Quick boolean check — is this prompt adversarial at all? */
export function scanPrompt(text: string): boolean {
  return detectAdversarial(text).detected;
}

export function detectAdversarial(text: string): AdversarialResult {
  const matchedPatterns: string[] = [];
  let totalScore = 0;

  for (const { name, pattern, weight } of ADVERSARIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      matchedPatterns.push(name);
      totalScore += weight;
    }
    pattern.lastIndex = 0;
  }

  const detected = totalScore >= 40;
  const reason = detected ? `Adversarial patterns detected: ${matchedPatterns.join(', ')}` : '';

  return { detected, reason, patterns: matchedPatterns, score: Math.min(totalScore, 100) };
}
