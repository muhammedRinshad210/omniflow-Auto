import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptAesGcm,
  decryptAesGcm,
  computeKeyedLookupHash,
  verifyMetaHmac,
  timingSafeStringEqual
} from '../apps/api/src/services/crypto.ts';

describe('OmniFlow Cryptographic Services Tests', () => {
  const testKeyBase64 = btoa('01234567890123456789012345678901'); // 32-byte key
  const altKeyBase64 = btoa('98765432109876543210987654321098');
  const testSecretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  test('AES-256-GCM encryption and decryption round-trip', async () => {
    const originalText = 'EAAG1234567890SystemUserTokenSecret';
    const encrypted = await encryptAesGcm(originalText, testKeyBase64);

    assert.ok(encrypted.startsWith('v1:'), 'Encrypted string must begin with v1:');
    assert.notEqual(encrypted, originalText);

    const decrypted = await decryptAesGcm(encrypted, testKeyBase64);
    assert.equal(decrypted, originalText);
  });

  test('AES-256-GCM decryption fails with incorrect master key', async () => {
    const originalText = 'SecretPayload';
    const encrypted = await encryptAesGcm(originalText, testKeyBase64);

    await assert.rejects(
      async () => {
        await decryptAesGcm(encrypted, altKeyBase64);
      },
      /operation failed|tag/i,
      'Decryption with wrong key must fail authentication check'
    );
  });

  test('AES-256-GCM decryption fails on tampered ciphertext', async () => {
    const originalText = 'SecretPayload';
    const encrypted = await encryptAesGcm(originalText, testKeyBase64);
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === 'aa' ? 'bb' : 'aa');

    await assert.rejects(
      async () => {
        await decryptAesGcm(tampered, testKeyBase64);
      },
      /operation failed|tag/i,
      'Decryption of tampered ciphertext must fail'
    );
  });

  test('Keyed HMAC-SHA256 lookup hash is deterministic and collision-resistant', async () => {
    const phone1 = '919876543210';
    const phone2 = '919876543211';

    const hash1a = await computeKeyedLookupHash(phone1, testSecretHex);
    const hash1b = await computeKeyedLookupHash(phone1, testSecretHex);
    const hash2 = await computeKeyedLookupHash(phone2, testSecretHex);

    assert.equal(hash1a, hash1b, 'Hash must be strictly deterministic');
    assert.notEqual(hash1a, hash2, 'Different numbers must produce distinct hashes');
    assert.equal(hash1a.length, 64, 'SHA-256 hex digest must be 64 characters');
  });

  test('verifyMetaHmac using crypto.subtle.verify', async () => {
    const appSecret = 'meta_app_secret_12345';
    const rawBody = new TextEncoder().encode('{"object":"whatsapp_business_account"}').buffer;

    // Generate expected HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, rawBody);
    const sigHex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const validHeader = `sha256=${sigHex}`;
    const invalidHeader = `sha256=${sigHex.slice(0, -2)}00`;

    const isValid = await verifyMetaHmac(rawBody, validHeader, appSecret);
    const isInvalid = await verifyMetaHmac(rawBody, invalidHeader, appSecret);
    const isMissing = await verifyMetaHmac(rawBody, undefined, appSecret);

    assert.equal(isValid, true, 'Valid signature must verify');
    assert.equal(isInvalid, false, 'Invalid signature must be rejected');
    assert.equal(isMissing, false, 'Missing signature must be rejected');
  });

  test('timingSafeStringEqual', () => {
    assert.equal(timingSafeStringEqual('verify_token_123', 'verify_token_123'), true);
    assert.equal(timingSafeStringEqual('verify_token_123', 'verify_token_124'), false);
    assert.equal(timingSafeStringEqual('short', 'much_longer_string'), false);
    assert.equal(timingSafeStringEqual('', ''), true);
  });
});
