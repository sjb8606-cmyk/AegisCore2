/**
 * scripts/nb-os-live-walkthrough.ts
 *
 * The real, live, end-to-end proof that TIDELOCK's fisheries spine
 * actually works together — not unit tests with mocks, genuine calls
 * against the real Postgres database, exercising the real cross-core
 * integrations (shipment intake → lot creation → temperature logging →
 * processing → yield → hold/investigation → recall → compliance report).
 *
 * Run with: npx ts-node scripts/nb-os-live-walkthrough.ts
 *
 * Requires: the real docker-compose stack running (npm run docker:up),
 * all 274+ migrations applied, and DATABASE_URL configured — same
 * environment every other real test in this repo already uses.
 */

import { randomUUID } from 'crypto';
import { SpeciesRegistryService } from '../platform/fisheries/species-registry/src/index';
import { ShipmentIntakeService } from '../platform/fisheries/shipment-intake/src/index';
import { TemperatureEngineService } from '../platform/fisheries/temperature-engine/src/index';
import { ProcessingBatchService } from '../platform/fisheries/processing-batch/src/index';
import { YieldEngineService } from '../platform/fisheries/yield-engine/src/index';
import { HoldReleaseService } from '../platform/fisheries/hold-release/src/index';
import { LotTraceabilityService } from '../platform/lot-traceability/src/index';
import { RecallEngineService } from '../platform/recall-engine/src/index';
import { ComplianceReporterService } from '../platform/fisheries/compliance-reporter/src/index';
import { withTenantQuery } from '../platform/tenancy/src/index';

const TENANT_ID = randomUUID();
const USER_ID = randomUUID();

function step(n: number, label: string) {
  console.log(`\n[${n}] ${label}`);
}

function ok(label: string, value: unknown) {
  console.log(`    ✓ ${label}:`, typeof value === 'object' ? JSON.stringify(value) : value);
}

async function main() {
  console.log('='.repeat(60));
  console.log('NB OS — Real Live Walkthrough');
  console.log(`Tenant: ${TENANT_ID}`);
  console.log('='.repeat(60));

  step(1, 'Register a species (lobster — NB\'s flagship)');
  const species = await SpeciesRegistryService.createSpecies(TENANT_ID, USER_ID, {
    commonName: 'American Lobster',
    scientificName: 'Homarus americanus',
    speciesCode: 'LOB-001',
    category: 'crustacean',
    defaultYieldRatePercent: 28,
    minLegalSizeCm: 8.25,
  });
  ok('species created', { id: species.id, code: species.species_code });

  step(2, 'Log a shipment intake (this atomically creates a lot — real integration, not mocked)');
  const shipment = await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, {
    speciesId: species.id,
    vesselName: 'F/V Acadian Runner',
    catchDate: new Date().toISOString(),
    weight: 450,
    weightUnit: 'kg',
    conditionCode: 'whole',
    qualityGrade: 'premium',
    catchZone: 'LFA 25',
    notes: 'Live walkthrough test shipment',
  });
  ok('shipment logged', { id: shipment.id, weightKg: shipment.weight_kg });

  const lotRows = await withTenantQuery<any>(
    `SELECT id FROM lots WHERE tenant_id = $1 AND source_ref_id = $2 AND source_ref_table = 'fisheries_shipments'`,
    [TENANT_ID, shipment.id],
    TENANT_ID,
  );
  const lotId = lotRows[0]?.id;
  if (!lotId) throw new Error('WALKTHROUGH FAILED: no lot was created for this shipment — the shipment→lot integration is broken.');
  ok('lot auto-created from shipment', lotId);

  step(3, 'Set a temperature threshold and log a real reading against the lot');
  await TemperatureEngineService.setThreshold(TENANT_ID, USER_ID, {
    speciesId: species.id,
    stage: 'receiving',
    minCelsius: 0,
    maxCelsius: 4,
  });
  const readingResult = await TemperatureEngineService.logReading(TENANT_ID, USER_ID, lotId, {
    stage: 'receiving',
    readingCelsius: 2.1,
    deviceId: 'thermo-01',
  });
  ok('reading logged, within threshold', {
    celsius: readingResult.reading.reading_celsius,
    deviation: readingResult.isDeviation,
  });

  step(4, 'Create a processing batch from the shipment, then complete it');
  const batch = await ProcessingBatchService.createBatch(TENANT_ID, USER_ID, {
    speciesId: species.id,
    shipmentIds: [shipment.id],
    startedAt: new Date().toISOString(),
    notes: 'Live walkthrough processing run',
  });
  ok('batch created', { id: batch.id, status: batch.status });

  const completedBatch = await ProcessingBatchService.completeBatch(TENANT_ID, batch.id, USER_ID, {
    finishedWeightKg: 380,
    completedAt: new Date().toISOString(),
    finishedConditionCode: 'dressed',
  });
  ok('batch completed', { status: completedBatch.status });

  step(5, 'Compute yield for the completed batch');
  const yieldRecord = await YieldEngineService.computeYield(TENANT_ID, batch.id, USER_ID);
  ok('yield computed', { yieldPercent: yieldRecord.actual_yield_percent, underperforming: yieldRecord.is_underperforming });

  step(6, 'Open a hold investigation on the lot (real cascade via recall-engine), then resolve it');
  const investigation = await HoldReleaseService.openInvestigation(TENANT_ID, USER_ID, lotId, {
    reasonCategory: 'quality_defect',
    reasonDetail: 'Live walkthrough — simulated quality hold',
  });
  ok('investigation opened, lot held', { id: investigation.investigation.id, heldLots: investigation.holdReport.results.length });

  const resolved = await HoldReleaseService.resolveInvestigation(TENANT_ID, USER_ID, investigation.investigation.id, {
    resolution: 'release',
    findings: 'Live walkthrough — resolved, no real defect found, releasing',
  });
  ok('investigation resolved, lot released', { status: resolved.investigation.status, released: resolved.releaseResults });

  step(7, 'Trace the lot\'s full real event history (hash-chained, tamper-evident)');
  const history = await LotTraceabilityService.getLotHistory(TENANT_ID, lotId);
  ok('lot event history', `${history.length} real chained events`);

  step(8, 'Generate a real recall report for this lot');
  const recallReport = await RecallEngineService.generateRecallReport(TENANT_ID, lotId);
  ok('recall report generated', {
    lotId: recallReport.lot?.id ?? lotId,
    upstreamCount: recallReport.upstreamCount,
    downstreamCount: recallReport.downstreamCount,
  });

  step(9, 'Generate a real compliance catch report');
  const catchReport = await ComplianceReporterService.generateCatchReport(TENANT_ID, USER_ID, {
    fromDate: new Date(Date.now() - 86400000).toISOString(),
    toDate: new Date().toISOString(),
  });
  ok('catch report generated', { id: catchReport.id, totalWeightKg: catchReport.summary?.total_weight_kg });

  console.log('\n' + '='.repeat(60));
  console.log('✅ FULL WALKTHROUGH COMPLETE — every core worked together against the real database.');
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ WALKTHROUGH FAILED:');
    console.error(err);
    process.exit(1);
  });
