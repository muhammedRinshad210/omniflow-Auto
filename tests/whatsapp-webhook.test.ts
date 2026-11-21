import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { honoApp } from '../apps/api/src/index.ts';

function createTestD1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async run() {
              const info = db.prepare(sql).run(...args);
              return { success: true, meta: { rows_written: Number(info.changes) } };
            },
            async all<T = any>() {
              const rows = db.prepare(sql).all(...args) as T[];
              return { success: true, results: rows };
            },
            async first<T = any>(col?: string): Promise<T | null> {
              const row = db.prepare(sql).get(...args) as any;
              if (!row) return null;
              return col ? row[col] : (row as T);
            }
          };
        },
        async run() {
          const info = db.prepare(sql).run();
          return { success: true, meta: { rows_written: Number(info.changes) } };
        },
        async all<T = any>() {
          const rows = db.prepare(sql).all() as T[];
          return { success: true, results: rows };
        },
        async first<T = any>(col?: string): Promise<T | null> {
          const row = db.prepare(sql).get() as any;
          if (!row) return null;
          return col ? row[col] : (row as T);
        }
      };
    }
  } as unknown as D1Database;
}

async function generateHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return (
    'sha256=' +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

describe('WhatsApp Webhook Ingestion Tests', () => {
  let db: DatabaseSync;
  let testD1: D1Database;

  const appSecret = 'test_meta_app_secret_12345';
  const verifyToken = 'test_meta_verify_token_xyz';
  const encryptionKey = btoa('01234567890123456789012345678901');
  const lookupSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const m1 = readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8');
    const m2 = readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8');
    const m3 = readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8');
    db.exec(m1);
    db.exec(m2);
    db.exec(m3);

    // Seed tenant and channel
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_01', 'Test Business', 'test-biz')").run();
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'live', 1, '[]', 'ml')
    `).run();
    db.prepare(`
      INSERT INTO channel_connections (
        id, tenant_id, channel_type, account_id, name,
        encrypted_access_token, token_preview, webhook_verify_token, status
      ) VALUES ('conn_wa_1', 'ten_01', 'whatsapp', '999888777', 'Main WA', 'v1:aa:bb', 'EAA...', 'token', 'active')
    `).run();

    testD1 = createTestD1(db);
  });

  const getEnv = () => ({
    DB: testD1,
    META_APP_SECRET: appSecret,
    META_WEBHOOK_VERIFY_TOKEN: verifyToken,
    ENCRYPTION_KEY: encryptionKey,
    LOOKUP_HASH_SECRET: lookupSecret
  });

  test('GET verification returns challenge with 200 on token match', async () => {
    const url = `http://localhost/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=test_challenge_12345`;
    const res = await honoApp.request(url, {}, getEnv());

    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, 'test_challenge_12345');
  });

  test('GET verification returns 403 on token mismatch', async () => {
    const url = `http://localhost/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=12345`;
    const res = await honoApp.request(url, {}, getEnv());

    assert.equal(res.status, 403);
  });

  test('POST rejects requests with invalid or missing HMAC signature', async () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    // Missing signature
    const resMissing = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      },
      getEnv()
    );
    assert.equal(resMissing.status, 401);

    // Invalid signature
    const resInvalid = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
        },
        body: payload
      },
      getEnv()
    );
    assert.equal(resInvalid.status, 401);
  });

  test('POST processes valid inbound message and inserts into D1', async () => {
    const payloadObj = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WH_ACC_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15551234567', phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Priya Nair' }, wa_id: '919876543210' }],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.HBgTEST001',
                    timestamp: '1710000000',
                    text: { body: 'Hello clinic' },
                    type: 'text'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const payload = JSON.stringify(payloadObj);
    const signature = await generateHmac(appSecret, payload);

    const res = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature
        },
        body: payload
      },
      getEnv()
    );

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'EVENT_RECEIVED');

    // Verify D1 records
    const eventRow = db.prepare('SELECT * FROM webhook_events WHERE dedupe_key = ?').get('wamid.HBgTEST001') as any;
    assert.ok(eventRow, 'webhook_event must be recorded');
    assert.equal(eventRow.processing_status, 'processed');

    const msgRow = db.prepare('SELECT * FROM messages WHERE provider_message_id = ?').get('wamid.HBgTEST001') as any;
    assert.ok(msgRow, 'message must be recorded');
    assert.equal(msgRow.body, 'Hello clinic');
    assert.equal(msgRow.direction, 'inbound');

    const contactRow = db.prepare('SELECT * FROM contacts WHERE tenant_id = ?').get('ten_01') as any;
    assert.ok(contactRow, 'contact must be created');
    assert.equal(contactRow.display_name, 'Priya Nair');
    assert.equal(contactRow.phone_number_masked, '+91 98**** 3210');
  });

  test('POST status update updates delivery_status and prevents downgrade', async () => {
    // Insert initial contact & conversation for outbound message
    db.prepare(`
      INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash)
      VALUES ('cnt_01', 'ten_01', 'whatsapp', 'v1:a:b', 'hash01')
    `).run();
    db.prepare(`
      INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id)
      VALUES ('conv_01', 'ten_01', 'conn_wa_1', 'cnt_01')
    `).run();
    db.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, channel_connection_id,
        direction, sender_type, message_type, provider_message_id, body, delivery_status
      ) VALUES ('msg_01', 'ten_01', 'conv_01', 'conn_wa_1', 'outbound', 'bot', 'text', 'wamid.STATUS_TEST', 'Hello', 'sent')
    `).run();

    // 1. Send 'delivered' status update
    const deliveredPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                statuses: [{ id: 'wamid.STATUS_TEST', status: 'delivered', timestamp: '1710000010', recipient_id: '919876543210' }]
              }
            }
          ]
        }
      ]
    });

    const sigDelivered = await generateHmac(appSecret, deliveredPayload);
    const res1 = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sigDelivered }, body: deliveredPayload },
      getEnv()
    );
    assert.equal(res1.status, 200);

    let msg = db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get('msg_01') as any;
    assert.equal(msg.delivery_status, 'delivered', 'Status should advance to delivered');

    // 2. Send 'read' status update
    const readPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                statuses: [{ id: 'wamid.STATUS_TEST', status: 'read', timestamp: '1710000020', recipient_id: '919876543210' }]
              }
            }
          ]
        }
      ]
    });
    const sigRead = await generateHmac(appSecret, readPayload);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sigRead }, body: readPayload },
      getEnv()
    );

    msg = db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get('msg_01') as any;
    assert.equal(msg.delivery_status, 'read', 'Status should advance to read');

    // 3. Stale 'delivered' event arriving later must NOT downgrade status from 'read'
    const staleDeliveredPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                statuses: [{ id: 'wamid.STATUS_TEST', status: 'delivered', timestamp: '1710000030', recipient_id: '919876543210' }]
              }
            }
          ]
        }
      ]
    });
    const sigStale = await generateHmac(appSecret, staleDeliveredPayload);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sigStale }, body: staleDeliveredPayload },
      getEnv()
    );

    msg = db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get('msg_01') as any;
    assert.equal(msg.delivery_status, 'read', 'Status must NOT be downgraded from read to delivered');
  });

  test('BUG 1: Ingestion batch with [new_1, duplicate, new_2] processes all new messages without message loss', async () => {
    // 1. Seed pre-existing message
    const preExistingWamid = 'wamid.BATCH_PRE_EXISTING';
    const prePayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Alice' }, wa_id: '919876543210' }],
                messages: [{ from: '919876543210', id: preExistingWamid, timestamp: '1710000001', text: { body: 'Pre-existing' }, type: 'text' }]
              }
            }
          ]
        }
      ]
    });
    const preSig = await generateHmac(appSecret, prePayload);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': preSig }, body: prePayload },
      getEnv()
    );

    // 2. Send batch with [new_1, pre_existing (duplicate), new_2]
    const wamidNew1 = 'wamid.BATCH_NEW_001';
    const wamidNew2 = 'wamid.BATCH_NEW_002';

    const batchPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Alice' }, wa_id: '919876543210' }],
                messages: [
                  { from: '919876543210', id: wamidNew1, timestamp: '1710000002', text: { body: 'New Message 1' }, type: 'text' },
                  { from: '919876543210', id: preExistingWamid, timestamp: '1710000001', text: { body: 'Duplicate' }, type: 'text' },
                  { from: '919876543210', id: wamidNew2, timestamp: '1710000003', text: { body: 'New Message 2' }, type: 'text' }
                ]
              }
            }
          ]
        }
      ]
    });

    const batchSig = await generateHmac(appSecret, batchPayload);
    const res = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': batchSig }, body: batchPayload },
      getEnv()
    );

    assert.equal(res.status, 200);

    // Assert that BOTH new messages were inserted into messages and processed
    const msg1 = db.prepare('SELECT * FROM messages WHERE provider_message_id = ?').get(wamidNew1) as any;
    assert.ok(msg1, 'New Message 1 must be inserted into messages table');

    const msg2 = db.prepare('SELECT * FROM messages WHERE provider_message_id = ?').get(wamidNew2) as any;
    assert.ok(msg2, 'New Message 2 must be inserted into messages table (not lost due to duplicate in batch)');
  });

  test('BUG 2 & CORRECTION 1: Batch with [unregistered phone_number_id, registered phone_number_id] continues and processes registered event', async () => {
    const regWamid = 'wamid.REGISTERED_001';
    const unregWamid = 'wamid.UNREGISTERED_001';

    const batchPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '8888888888_unknown_number' },
                contacts: [{ profile: { name: 'Bob' }, wa_id: '919876543220' }],
                messages: [{ from: '919876543220', id: unregWamid, timestamp: '1710000010', text: { body: 'Unknown account' }, type: 'text' }]
              }
            },
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Alice' }, wa_id: '919876543210' }],
                messages: [{ from: '919876543210', id: regWamid, timestamp: '1710000011', text: { body: 'Registered account' }, type: 'text' }]
              }
            }
          ]
        }
      ]
    });

    const sig = await generateHmac(appSecret, batchPayload);
    const res = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: batchPayload },
      getEnv()
    );

    assert.equal(res.status, 200, 'Batch with unregistered channel must return 200 without foreign key 500 error');

    // Unregistered event must not be inserted into D1
    const unregRow = db.prepare('SELECT * FROM webhook_events WHERE dedupe_key = ?').get(unregWamid);
    assert.equal(unregRow, undefined, 'Unregistered channel event must be safely ignored and not written');

    // Registered event must be fully inserted and processed
    const regRow = db.prepare('SELECT * FROM messages WHERE provider_message_id = ?').get(regWamid) as any;
    assert.ok(regRow, 'Registered event must be processed and recorded');
  });

  test('BUG 4 & CORRECTION 4: Missing or invalid hex cryptographic secrets fail closed with 500 and write nothing', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                messages: [{ from: '919876543210', id: 'wamid.CRYPTO_FAIL', timestamp: '1710000000', text: { body: 'Test' }, type: 'text' }]
              }
            }
          ]
        }
      ]
    });
    const sig = await generateHmac(appSecret, payload);

    // 1. Missing ENCRYPTION_KEY
    const envMissingKey = { ...getEnv(), ENCRYPTION_KEY: undefined };
    const res1 = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      envMissingKey
    );
    assert.equal(res1.status, 500, 'Missing ENCRYPTION_KEY must fail closed with 500');

    // 2. Non-hex LOOKUP_HASH_SECRET
    const envNonHex = { ...getEnv(), LOOKUP_HASH_SECRET: 'this_is_not_hexadecimal_string_at_all!!' };
    const res2 = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      envNonHex
    );
    assert.equal(res2.status, 500, 'Non-hex LOOKUP_HASH_SECRET must fail closed with 500');

    // 3. Odd-length LOOKUP_HASH_SECRET
    const envOddHex = { ...getEnv(), LOOKUP_HASH_SECRET: '0123456789abcdef0123456789abcdef0' };
    const res3 = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      envOddHex
    );
    assert.equal(res3.status, 500, 'Odd-length LOOKUP_HASH_SECRET must fail closed with 500');

    // Ensure NOTHING was written to D1
    const eventRow = db.prepare('SELECT * FROM webhook_events WHERE dedupe_key = ?').get('wamid.CRYPTO_FAIL');
    assert.equal(eventRow, undefined, 'Zero rows must be written to D1 when secrets are invalid or missing');
  });

  test('BUG 5: raw_payload_preview masks phone numbers and contains NO run of 6 or more consecutive digits', async () => {
    const rawPhoneNumber = '919876543210';
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Priya' }, wa_id: rawPhoneNumber }],
                messages: [{ from: rawPhoneNumber, id: 'wamid.PII_TEST_01', timestamp: '1710000000', text: { body: 'Hello' }, type: 'text' }]
              }
            }
          ]
        }
      ]
    });
    const sig = await generateHmac(appSecret, payload);

    const res = await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      getEnv()
    );
    assert.equal(res.status, 200);

    const eventRow = db.prepare('SELECT raw_payload_preview FROM webhook_events WHERE dedupe_key = ?').get('wamid.PII_TEST_01') as any;
    assert.ok(eventRow, 'Event row must be created');

    const preview = eventRow.raw_payload_preview as string;
    assert.equal(preview.includes(rawPhoneNumber), false, 'Full phone number must not appear in raw preview');

    // Strict assertion: NO run of 6 or more consecutive digits across the entire preview
    const hasLongDigitRun = /\d{6,}/.test(preview);
    assert.equal(hasLongDigitRun, false, `raw_payload_preview must contain NO sequence of 6 or more consecutive digits (found in: ${preview})`);
  });
});
