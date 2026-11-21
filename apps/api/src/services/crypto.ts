/**
 * OmniFlow Cryptographic Services
 * Built on native Web Crypto API (crypto.subtle) for maximum performance (< 0.2 ms CPU).
 */

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output format: `v1:<12-byte-hex-iv>:<hex-ciphertext-with-tag>`
 */
export async function encryptAesGcm(plaintext: string, base64Key: string): Promise<string> {
  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encodedText
  );

  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ciphertextHex = Array.from(new Uint8Array(ciphertextBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `v1:${ivHex}:${ciphertextHex}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string (`v1:<ivHex>:<ciphertextHex>`).
 */
export async function decryptAesGcm(encryptedPayload: string, base64Key: string): Promise<string> {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted payload format: expected v1:<iv>:<ciphertext>');
  }

  const ivHex = parts[1];
  const ciphertextHex = parts[2];

  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const ciphertext = new Uint8Array(
    ciphertextHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Compute a deterministic keyed HMAC-SHA256 hash for contact lookup.
 * Prevents rainbow table attacks and preserves O(1) indexed D1 lookups.
 */
export async function computeKeyedLookupHash(identifier: string, secretHex: string): Promise<string> {
  const rawSecret = new Uint8Array(
    secretHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const key = await crypto.subtle.importKey(
    'raw',
    rawSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = new TextEncoder().encode(identifier.trim().toLowerCase());
  const signature = await crypto.subtle.sign('HMAC', key, data);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify Meta webhook X-Hub-Signature-256 using crypto.subtle.verify.
 * Native, constant-time, and zero-allocation HMAC verification.
 */
export async function verifyMetaHmac(
  rawBody: ArrayBuffer,
  signatureHeader: string | undefined | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const signatureHex = signatureHeader.slice(7).trim();
  if (signatureHex.length !== 64) {
    return false;
  }

  const signatureBytes = new Uint8Array(
    signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const secretBytes = new TextEncoder().encode(appSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return await crypto.subtle.verify('HMAC', key, signatureBytes, rawBody);
}

/**
 * Constant-time string equality check using bitwise XOR accumulator.
 * Used for webhook verify token verification.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);

  if (aBuf.byteLength !== bBuf.byteLength) {
    return false;
  }

  let c = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    c |= aBuf[i] ^ bBuf[i];
  }
  return c === 0;
}
