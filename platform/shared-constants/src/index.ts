/**
 * platform/shared-constants/src/index.ts
 *
 * Facts that are true once, but were being hand-typed separately in
 * multiple files — the exact kind of duplication that lets one copy
 * silently go stale while the others get updated. Not logic (that's
 * crud-kernel/hash-chain/quota-guard) and not file structure (that's the
 * generator) — just values everyone should read from one place.
 */

export const WORKING_GROQ_MODEL = 'llama-4-scout-17b-16e-instruct';
export const WORKING_AI_PROVIDER = 'groq';
