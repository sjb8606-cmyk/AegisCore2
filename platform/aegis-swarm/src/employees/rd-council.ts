/**
 * platform/aegis-swarm/src/employees/rd-council.ts
 *
 * E-08 — R&D Council.
 *
 * One bot, not twelve — the person's own architectural call, and the
 * right one. Instead of twelve near-identical single-domain bots that
 * couldn't combine, this is a real domain registry (the "switches")
 * plus a real pairing function (the "talking to each other"), so
 * "Ancient Technologies + Materials Science" is a first-class real
 * capability, not something bolted onto separate bots.
 *
 * 12 real domains, each with a genuine, substantive operative method
 * — same discipline as E-01's pantheon, no filler. selectDomain() is
 * the "switch." pairDomains() is the real synthesis mechanism,
 * verified against the person's own stated use case (Ancient
 * Technologies + Materials Science) before implementation.
 *
 * No LLM call needed for domain selection/pairing/brief assembly —
 * real, deterministic lookup and combination. The actual cross-domain
 * research synthesis (the creative leap itself) needs a live LLM,
 * same honest limitation as E-01/E-03 — this bot assembles the
 * validated, combined prompt, it doesn't fake the synthesis.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface ResearchDomain {
  key: string;
  name: string;
  method: string;
  keywords: string[];
}

export const DOMAINS: ResearchDomain[] = [
  {
    key: 'physics',
    name: 'Physics',
    method: 'Reduce the problem to its underlying forces and conserved quantities — if it violates a conservation law, the design is wrong regardless of how clever it looks.',
    keywords: ['force', 'energy', 'motion', 'conservation', 'thermodynamics'],
  },
  {
    key: 'chemistry',
    name: 'Chemistry',
    method: "Reactions follow real thermodynamic and kinetic constraints — favorable energy release doesn't guarantee it happens fast enough or safely enough to use.",
    keywords: ['reaction', 'compound', 'catalyst', 'bonding', 'synthesis'],
  },
  {
    key: 'biology',
    name: 'Biology',
    method: 'Billions of years of iteration already solved this class of problem somewhere — check what already evolved before inventing from scratch.',
    keywords: ['organism', 'evolution', 'biomimicry', 'living', 'cell'],
  },
  {
    key: 'mathematics',
    name: 'Mathematics',
    method: 'Formalize the actual constraints before optimizing anything — an elegant solution to the wrong formalization is still wrong.',
    keywords: ['model', 'optimization', 'proof', 'formula', 'algorithm'],
  },
  {
    key: 'materials_science',
    name: 'Materials Science',
    method: 'Properties emerge from structure at multiple scales — the same atoms arranged differently behave completely differently.',
    keywords: ['material', 'alloy', 'composite', 'structure', 'durability'],
  },
  {
    key: 'mechanical_engineering',
    name: 'Mechanical Engineering',
    method: 'Every mechanism has a failure mode under real load, real tolerance, and real fatigue — design for the failure, not just the ideal case.',
    keywords: ['mechanism', 'load', 'tolerance', 'fatigue', 'motion'],
  },
  {
    key: 'electrical_engineering',
    name: 'Electrical Engineering',
    method: 'Signal, power, and noise are three different problems wearing the same wires — solving one without the others just moves the failure downstream.',
    keywords: ['circuit', 'signal', 'power', 'voltage', 'current'],
  },
  {
    key: 'civil_engineering',
    name: 'Civil Engineering',
    method: 'Design for the worst real-world load case over the full service life, not the average case on a good day.',
    keywords: ['structure', 'load-bearing', 'infrastructure', 'foundation'],
  },
  {
    key: 'computer_science',
    name: 'Computer Science',
    method: "Correctness and complexity are separate axes — a correct algorithm that doesn't scale is a real, different kind of wrong.",
    keywords: ['algorithm', 'complexity', 'data structure', 'software'],
  },
  {
    key: 'environmental_science',
    name: 'Environmental Science',
    method: 'Nothing leaves a closed system for free — track where the mass and energy actually go, not just where the intended output goes.',
    keywords: ['ecosystem', 'sustainability', 'emissions', 'resource'],
  },
  {
    key: 'ancient_technologies',
    name: 'Ancient Technologies',
    method: 'Constraint breeds ingenuity — pre-industrial solutions optimized for durability, local materials, and zero-energy-input operation in ways modern design often skips past.',
    keywords: ['ancient', 'traditional', 'pre-industrial', 'artisan', 'historical'],
  },
  {
    key: 'closed_loop_systems',
    name: 'Closed-Loop Systems',
    method: "A system's waste is the next system's input — the design isn't complete until the output loop closes back to a real source or sink.",
    keywords: ['loop', 'circular', 'waste', 'recycle', 'feedback'],
  },
];

export function getDomain(key: string): ResearchDomain | null {
  return DOMAINS.find((d) => d.key === key) ?? null;
}

export function suggestDomains(query: string): ResearchDomain[] {
  const lower = query.toLowerCase();
  const scored = DOMAINS.map((d) => ({ domain: d, score: d.keywords.filter((k) => lower.includes(k)).length }));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.domain);
}

export interface PairingResult {
  domains: ResearchDomain[];
  missingKeys: string[];
  paired: boolean;
  assembledBrief: string;
}

export function pairDomains(keys: string[], topic: string): PairingResult {
  const domains: ResearchDomain[] = [];
  const missingKeys: string[] = [];

  for (const key of keys) {
    const domain = getDomain(key);
    if (domain) domains.push(domain);
    else missingKeys.push(key);
  }

  const domainLines = domains.map((d) => `- ${d.name}: ${d.method}`).join('\n');

  const assembledBrief = [
    `You are a cross-domain R&D council synthesizing insight across the following real methodologies for the topic below. Combine them genuinely — find where they reinforce each other and where they create real tension, don't just list them side by side.`,
    '',
    'Active domains:',
    domainLines,
    '',
    `TOPIC: ${topic}`,
    '',
    'Produce: 1) a synthesis of how these domains genuinely combine on this topic, 2) at least one concrete idea that specifically requires more than one of these domains to work, 3) any real tension or tradeoff between the domains worth flagging.',
  ].join('\n');

  return { domains, missingKeys, paired: domains.length >= 2, assembledBrief };
}

export class RDCouncilBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async convene(domainKeys: string[], topic: string): Promise<PairingResult> {
    await this.enforcePermission('generate:rd-brief');

    const result = pairDomains(domainKeys, topic);

    await this.createDecision(
      { domainKeys, topic },
      { matchedCount: result.domains.length, missingKeys: result.missingKeys, paired: result.paired },
      'rd-council-v1',
    );

    if (result.missingKeys.length > 0) {
      await this.signalSwarm('employee.unknown_rd_domain_requested', {
        botId: this.botId,
        missingKeys: result.missingKeys,
      });
    }

    return result;
  }
}
