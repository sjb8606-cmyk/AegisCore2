/**
 * platform/aegis-swarm/src/bots/threat-intel-aggregator.ts
 *
 * D-05 — Threat Intel Aggregator.
 *
 * Normalizes STIX/MISP threat feed data (already in hand — a bundle
 * or event JSON from a file, another integration, or a manual export)
 * into one common ThreatIndicator shape. Real, tested, no network
 * required.
 *
 * STIX pattern parsing is deliberately limited to the simple
 * single-comparison case: `[object-type:property = 'value']`. Full
 * STIX Pattern grammar (boolean composition, comparison operators
 * beyond `=`, qualifiers) is NOT implemented — a pattern this parser
 * can't confidently interpret is skipped and reported, never guessed
 * at or silently dropped.
 *
 * LIVE TAXII FETCHING IS NOT AVAILABLE. fetchTaxiiCollection() throws
 * a clear, honest error: this repo has no TAXII 2.x client and no
 * credentials or mock server to verify a real HTTP round-trip against.
 * normalizeStixBundle() works today against a bundle already in hand.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface ThreatIndicator {
  source: 'stix' | 'misp';
  indicatorType: string;
  value: string;
  confidence?: number;
  tags: string[];
  firstSeen?: string;
  rawId: string;
}

export interface NormalizationReport {
  indicators: ThreatIndicator[];
  parsedCount: number;
  skippedCount: number;
  skippedIds: string[];
}

const SIMPLE_STIX_PATTERN =
  /^\[([a-zA-Z0-9_-]+):([a-zA-Z0-9_.\[\]'-]+)\s*=\s*'([^']+)'\]$/;

interface StixObject {
  id: string;
  type: string;
  pattern?: string;
  valid_from?: string;
  confidence?: number;
  labels?: string[];
}

interface StixBundle {
  objects?: StixObject[];
}

interface MispAttribute {
  uuid?: string;
  id?: string | number;
  type?: string;
  value?: string;
  category?: string;
  timestamp?: string;
}

interface MispEventDocument {
  Event?: {
    Attribute?: MispAttribute[];
  };
}

export class ThreatIntelAggregatorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async normalizeStixBundle(bundle: StixBundle): Promise<NormalizationReport> {
    await this.enforcePermission('process:threat-intel');

    const indicatorObjects = (bundle.objects ?? []).filter((obj) => obj.type === 'indicator');
    const indicators: ThreatIndicator[] = [];
    const skippedIds: string[] = [];

    for (const obj of indicatorObjects) {
      const parsed = obj.pattern ? this.parseSimpleStixPattern(obj.pattern) : null;
      if (!parsed) {
        skippedIds.push(obj.id);
        continue;
      }

      indicators.push({
        source: 'stix',
        indicatorType: parsed.objectType,
        value: parsed.value,
        confidence: obj.confidence,
        tags: obj.labels ?? [],
        firstSeen: obj.valid_from,
        rawId: obj.id,
      });
    }

    await this.recordAndSignal('stix', indicators.length, skippedIds.length);

    return { indicators, parsedCount: indicators.length, skippedCount: skippedIds.length, skippedIds };
  }

  async normalizeMispEvent(event: MispEventDocument): Promise<NormalizationReport> {
    await this.enforcePermission('process:threat-intel');

    const attributes = event.Event?.Attribute ?? [];
    const indicators: ThreatIndicator[] = [];
    const skippedIds: string[] = [];

    attributes.forEach((attr, index) => {
      const id = attr.uuid ?? String(attr.id ?? index);
      if (!attr.type || !attr.value) {
        skippedIds.push(id);
        return;
      }

      indicators.push({
        source: 'misp',
        indicatorType: attr.type,
        value: attr.value,
        tags: attr.category ? [attr.category] : [],
        firstSeen: attr.timestamp ? new Date(Number(attr.timestamp) * 1000).toISOString() : undefined,
        rawId: id,
      });
    });

    await this.recordAndSignal('misp', indicators.length, skippedIds.length);

    return { indicators, parsedCount: indicators.length, skippedCount: skippedIds.length, skippedIds };
  }

  async fetchTaxiiCollection(_serverUrl: string, _collectionId: string): Promise<never> {
    throw new Error(
      'Live TAXII feed fetching is not available yet: this repo has no TAXII 2.x client, and there ' +
        'is no credentialed or mock server here to verify a real HTTP round-trip against. ' +
        'normalizeStixBundle() works today if you already have a STIX bundle JSON from some other ' +
        'source (a manual export, another integration, etc.).',
    );
  }

  private parseSimpleStixPattern(pattern: string): { objectType: string; value: string } | null {
    const match = pattern.match(SIMPLE_STIX_PATTERN);
    if (!match) return null;
    return { objectType: match[1], value: match[3] };
  }

  private async recordAndSignal(
    source: 'stix' | 'misp',
    parsedCount: number,
    skippedCount: number,
  ): Promise<void> {
    await this.createDecision(
      { source },
      { parsedCount, skippedCount },
      'threat-intel-normalize-v1',
    );

    if (parsedCount > 0) {
      await this.signalSwarm('threat_intel.indicators_aggregated', {
        botId: this.botId,
        source,
        count: parsedCount,
      });
    }
  }
}
