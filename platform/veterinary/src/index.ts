import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const VeterinaryConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    animalRecords: z.boolean().default(true),
    vaccinationTracking: z.boolean().default(true),
    appointmentScheduling: z.boolean().default(true),
    treatmentHistory: z.boolean().default(true),
    prescriptions: z.boolean().default(true),
    clinicalNotes: z.boolean().default(true),
    multiPetOwners: z.boolean().default(true),
    reminders: z.boolean().default(true),
    billingIntegration: z.boolean().default(false),
    labIntegrations: z.boolean().default(false),
    emergencyTriage: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    mobileVetSupport: z.boolean().default(false),
    shelterMode: z.boolean().default(false),
  }),
  limits: z.object({
    patientsPerTenant: z.number().default(500000),
    appointmentsPerMonth: z.number().default(200000),
    treatmentsPerMonth: z.number().default(1000000),
  }),
  thresholds: z.object({
    criticalCaseScore: z.number().default(0.85),
    emergencyTriageScore: z.number().default(0.9),
  }),
});

export type VeterinaryConfig = z.infer<typeof VeterinaryConfigSchema>;

function loadConfig(): VeterinaryConfig {
  const configPath = path.join(process.cwd(), 'config', 'veterinary.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return VeterinaryConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      animalRecords: true,
      vaccinationTracking: true,
      appointmentScheduling: true,
      treatmentHistory: true,
      prescriptions: true,
      clinicalNotes: true,
      multiPetOwners: true,
      reminders: true,
      billingIntegration: false,
      labIntegrations: false,
      emergencyTriage: false,
      advancedAnalytics: false,
      auditTrail: true,
      mobileVetSupport: false,
      shelterMode: false
    },
    limits: { patientsPerTenant: 500000, appointmentsPerMonth: 200000, treatmentsPerMonth: 1000000 },
    thresholds: { criticalCaseScore: 0.85, emergencyTriageScore: 0.9 }
  };
}

export async function registerAnimalPatient(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Veterinary module disabled', 'FORBIDDEN');

  const cleanUserId = parseUserId(userId);
  const patientId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO vet_patients (id, tenant_id, owner_id, name, species, breed, date_of_birth, sex, microchip_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `, [patientId, tenantId, cleanUserId, data.name, data.species, data.breed || null, data.date_of_birth || null, data.sex || 'unknown', data.microchip_id || null], tenantId);

  // Append entry to medical ledger
  await withTenantQuery(`
    INSERT INTO vet_medical_events (id, tenant_id, patient_id, event_type, log_message, logged_by)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [crypto.randomUUID(), tenantId, patientId, 'PATIENT_REGISTRATION', `Patient ${data.name} (Species: ${data.species}) registered.`, cleanUserId], tenantId);

  return res[0];
}

export async function addVaccinationRecord(tenantId: string, patientId: string, data: any, userId: string) {
  const cleanUserId = parseUserId(userId);
  if (!isValidUuid(patientId)) throw new AppError('Invalid Patient ID format.', 'BAD_REQUEST');

  const vaccinationId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO vet_vaccinations (id, tenant_id, patient_id, vaccine_name, administered_at, next_due_at, administrator_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [vaccinationId, tenantId, patientId, data.vaccine_name, data.administered_at, data.next_due_at, cleanUserId], tenantId);

  // Append entry to medical ledger
  await withTenantQuery(`
    INSERT INTO vet_medical_events (id, tenant_id, patient_id, event_type, log_message, logged_by)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [crypto.randomUUID(), tenantId, patientId, 'VACCINATION_ADMINISTERED', `Administered vaccine: ${data.vaccine_name}. Next booster due on: ${data.next_due_at}`, cleanUserId], tenantId);

  return res[0];
}

export async function createTreatmentPlan(tenantId: string, patientId: string, data: any, userId: string) {
  const cleanUserId = parseUserId(userId);
  if (!isValidUuid(patientId)) throw new AppError('Invalid Patient ID format.', 'BAD_REQUEST');

  const treatmentId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO vet_treatments (id, tenant_id, patient_id, title, status, diagnostic_notes)
    VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *;
  `, [treatmentId, tenantId, patientId, data.title, data.diagnostic_notes || null], tenantId);

  // Append entry to medical ledger
  await withTenantQuery(`
    INSERT INTO vet_medical_events (id, tenant_id, patient_id, event_type, log_message, logged_by)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [crypto.randomUUID(), tenantId, patientId, 'TREATMENT_STARTED', `Treatment program started: ${data.title}. Diagnostics: ${data.diagnostic_notes}`, cleanUserId], tenantId);

  return res[0];
}

export async function getPatientTimeline(tenantId: string, patientId: string) {
  if (!isValidUuid(patientId)) throw new AppError('Invalid Patient ID format.', 'BAD_REQUEST');

  const patientRes = await withTenantQuery(`
    SELECT * FROM vet_patients WHERE id = $1 AND tenant_id = $2;
  `, [patientId, tenantId], tenantId);

  if (!patientRes || patientRes.length === 0) {
    throw new AppError('Patient medical file not found.', 'NOT_FOUND');
  }

  const vaccinations = await withTenantQuery(`
    SELECT * FROM vet_vaccinations WHERE patient_id = $1 AND tenant_id = $2 ORDER BY administered_at DESC;
  `, [patientId, tenantId], tenantId);

  const treatments = await withTenantQuery(`
    SELECT * FROM vet_treatments WHERE patient_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [patientId, tenantId], tenantId);

  // Fetch chronological, append-only medical ledger log
  const medicalEvents = await withTenantQuery(`
    SELECT * FROM vet_medical_events WHERE patient_id = $1 AND tenant_id = $2 ORDER BY created_at ASC;
  `, [patientId, tenantId], tenantId);

  return {
    ...patientRes[0],
    vaccinations,
    treatments,
    medical_events: medicalEvents
  };
}
