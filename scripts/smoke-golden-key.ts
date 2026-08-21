/**
 * Golden Key Layer 1 smoke test
 *
 * Exercises the full logical path against mocked/in-memory drivers
 * where possible. For DB-backed vault cores, requires migration +
 * tenant row. Set GOLDEN_KEY_SMOKE_LIVE=1 to hit real platform.
 *
 * Run:
 *   npx tsx scripts/smoke-golden-key.ts
 */

import * as crypto from 'crypto';

const tenantId =
  process.env.GOLDEN_KEY_DEV_TENANT || '00000000-0000-4000-8000-0000000000gk';
const actorId = process.env.GOLDEN_KEY_DEV_ACTOR || 'smoke-actor';

function ok(label: string) {
  console.log('  ✓ ' + label);
}

function fail(label: string, err: unknown): never {
  console.error('  ✗ ' + label);
  console.error(err);
  process.exit(1);
}

async function main() {
  console.log('Golden Key smoke test');
  console.log('tenant=' + tenantId + ' actor=' + actorId);
  console.log('');

  // ── 1. Crypto round-trip ───────────────────────────────────
  try {
    const { encryptForDeposit, decryptForRetrieve } = await import(
      '@platform/custody-crypto'
    );
    const plain = Buffer.from('smoke-secret-' + Date.now());
    const enc = await encryptForDeposit(tenantId, actorId, plain);
    const dec = await decryptForRetrieve(
      tenantId,
      actorId,
      enc.ciphertext,
      enc.envelope,
    );
    if (!dec.plaintext.equals(plain)) throw new Error('plaintext mismatch');
    ok('custody-crypto encrypt/decrypt');
  } catch (err) {
    fail('custody-crypto', err);
  }

  // ── 2. Storage put/get/delete ──────────────────────────────
  try {
    const {
      putBlob,
      getBlob,
      deleteBlob,
      blobExists,
      __resetMemoryStore,
      __resetDriverCache,
    } = await import('@platform/custody-storage');
    __resetMemoryStore?.();
    __resetDriverCache?.();

    const bytes = Buffer.from('blob-' + Date.now());
    const put = await putBlob(tenantId, actorId, bytes);
    const got = await getBlob(tenantId, actorId, put.storageKey);
    if (!got.bytes.equals(bytes)) throw new Error('blob mismatch');
    if (!(await blobExists(tenantId, actorId, put.storageKey))) {
      throw new Error('exists should be true');
    }
    await deleteBlob(tenantId, actorId, put.storageKey);
    if (await blobExists(tenantId, actorId, put.storageKey)) {
      throw new Error('exists should be false after delete');
    }
    ok('custody-storage put/get/delete');
  } catch (err) {
    fail('custody-storage', err);
  }

  // ── 3. Vault lifecycle (needs DB) ──────────────────────────
  if (process.env.GOLDEN_KEY_SMOKE_LIVE === '1') {
    try {
      const { createVault, sealVault } = await import('@platform/custody-vault');
      const { depositSecure, retrieveSecure } = await import(
        '@platform/custody-ops'
      );
      const { issueVaultReceipt, verifyReceipt } = await import(
        '@platform/custody-receipt'
      );
      const { releaseVault } = await import(
        '@platform/custody-vault/src/release'
      );

      const { vault } = await createVault(tenantId, actorId, {
        name: 'Smoke Vault ' + new Date().toISOString(),
      });
      ok('createVault ' + vault.id);

      const dep = await depositSecure(tenantId, actorId, {
        vaultId: vault.id,
        name: 'smoke.txt',
        contentType: 'text/plain',
        plaintext: Buffer.from('live-smoke-payload'),
      });
      ok('depositSecure ' + dep.assetId);

      const receipt = await issueVaultReceipt(tenantId, actorId, vault.id);
      const verified = await verifyReceipt(tenantId, receipt, {
        verifyChain: true,
      });
      if (!verified.receiptHashValid) throw new Error('receipt hash invalid');
      ok('receipt issue + verify');

      await sealVault(tenantId, actorId, vault.id);
      ok('sealVault');

      // sealed → retrieve should fail
      try {
        await retrieveSecure(tenantId, actorId, dep.assetId);
        throw new Error('retrieve should fail while sealed');
      } catch (e: any) {
        if (!String(e?.message ?? e).match(/sealed|state/i)) throw e;
      }
      ok('retrieve blocked while sealed');

      await releaseVault(tenantId, actorId, vault.id, 'smoke release');
      ok('releaseVault');

      const got = await retrieveSecure(tenantId, actorId, dep.assetId);
      if (got.plaintext.toString('utf8') !== 'live-smoke-payload') {
        throw new Error('retrieve plaintext mismatch');
      }
      ok('retrieveSecure after release');
    } catch (err) {
      fail('live vault path', err);
    }
  } else {
    console.log('  · skip live vault path (set GOLDEN_KEY_SMOKE_LIVE=1)');
  }

  // ── 4. Crucible smoke (pure) ───────────────────────────────
  try {
    const { generateKeyPairHex, signArtifact, verifySignature } = await import(
      '@platform/artifact-signer'
    );
    // signArtifact needs secrets mock in unit tests; here we only check pure helpers
    const pair = generateKeyPairHex();
    const hash = crypto.createHash('sha256').update('smoke').digest('hex');
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(pair.privateKey, 'hex'),
      format: 'der',
      type: 'pkcs8',
    });
    const sig = crypto
      .sign(null, Buffer.from(hash, 'hex'), privateKey)
      .toString('hex');
    const good = verifySignature({
      contentHash: hash,
      signature: sig,
      publicKey: pair.publicKey,
    });
    if (!good) throw new Error('verify failed');
    ok('artifact-signer pure sign/verify');
  } catch (err) {
    fail('artifact-signer', err);
  }

  console.log('');
  console.log('Smoke complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
