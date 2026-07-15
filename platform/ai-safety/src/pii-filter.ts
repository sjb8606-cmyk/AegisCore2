export interface PiiFilterResult {
  sanitized: string;
  found: string[];
  redactions: number;
}

const PII_PATTERNS = [
  { type: 'email', pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL REDACTED]' },
  { type: 'phone', pattern: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]([0-9]{3})[-.\s]([0-9]{4})/g, replacement: '[PHONE REDACTED]' },
  { type: 'ssn', pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: '[SSN REDACTED]' },
  { type: 'credit_card', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, replacement: '[CARD REDACTED]' },
  { type: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, replacement: '[IP REDACTED]' },
  { type: 'dob', pattern: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/\d{4}\b|\b\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/g, replacement: '[DATE REDACTED]' }
];

export function filterPii(text: string): PiiFilterResult {
  let sanitized = text;
  const found = new Set<string>();
  let redactions = 0;

  for (const { type, pattern, replacement } of PII_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches && matches.length > 0) {
      found.add(type);
      redactions += matches.length;
      sanitized = sanitized.replace(pattern, replacement);
      pattern.lastIndex = 0;
    }
  }

  return { sanitized, found: Array.from(found), redactions };
}
