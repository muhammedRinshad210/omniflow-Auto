import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { computeKeyedLookupHash } from '../apps/api/src/services/crypto.ts';
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

function makeWebhookPayload(from: string, text: string, msgId: string) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '999888777' },
              contacts: [{ profile: { name: 'Customer' }, wa_id: from }],
              messages: [{ from, id: msgId, timestamp: '1710000000', text: { body: text }, type: 'text' }]
            }
          }
        ]
      }
    ]
  });
}

describe('WhatsApp Auto-Reply Rules, Safety & Guard Tests', () => {
  let db: DatabaseSync;
  let testD1: D1Database;

  const appSecret = 'secret_123';
  const verifyToken = 'verify_123';
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

    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_01', 'Test Biz', 'test-biz')").run();
    db.prepare(`
      INSERT INTO channel_connections (
        id, tenant_id, channel_type, account_id, name,
        encrypted_access_token, token_preview, webhook_verify_token, status
      ) VALUES ('conn_1', 'ten_01', 'whatsapp', '999888777', 'WA', 'v1:aa:bb', 'EAA...', 'token', 'active')
    `).run();

    // Seed 3 sample rules
    db.prepare(`
      INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
      VALUES ('rule_pricing', 'ten_01', 'Pricing', 'whatsapp', 'keyword_contains', '["price","rate","വില","ചിലവ്"]', 'text', '{"en":"Price starts from Rs. 500.","ml":"വില 500 രൂപ മുതൽ."}', 20, 1)
    `).run();

    db.prepare(`
      INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
      VALUES ('rule_fallback', 'ten_01', 'Fallback', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"Thank you. We will contact you.","ml":"നന്ദി. ഉടൻ ബന്ധപ്പെടാം."}', 0, 1)
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

  test('Allowlist in test mode fails closed when allowlist is empty', async () => {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'test', 1, '[]', 'ml')
    `).run();

    const payload = makeWebhookPayload('919876543210', 'price inquiry', 'wamid.ALLOW_EMPTY');
    const sig = await generateHmac(appSecret, payload);

    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      getEnv()
    );

    const replies = db.prepare("SELECT * FROM messages WHERE direction = 'outbound'").all();
    assert.equal(replies.length, 0, 'Zero replies must be sent when allowlist is empty');
  });

  test('Allowlist in test mode replies only to normalized allowlisted numbers', async () => {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'test', 1, '["+91 98765-43210"]', 'ml')
    `).run();

    // 1. Inbound from non-allowlisted number
    const payloadBlocked = makeWebhookPayload('919999999999', 'price', 'wamid.BLOCKED_NUM');
    const sigBlocked = await generateHmac(appSecret, payloadBlocked);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sigBlocked }, body: payloadBlocked },
      getEnv()
    );
    assert.equal(db.prepare("SELECT * FROM messages WHERE direction = 'outbound'").all().length, 0);

    // 2. Inbound from allowlisted number
    const payloadAllowed = makeWebhookPayload('919876543210', 'price', 'wamid.ALLOWED_NUM');
    const sigAllowed = await generateHmac(appSecret, payloadAllowed);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sigAllowed }, body: payloadAllowed },
      getEnv()
    );

    const allowedReplies = db.prepare("SELECT * FROM messages WHERE direction = 'outbound'").all() as any[];
    assert.equal(allowedReplies.length, 1, 'Allowlisted recipient must receive auto-reply');
    assert.equal(allowedReplies[0].is_simulated, 1);
    assert.equal(allowedReplies[0].delivery_status, 'simulated');
  });

  test('Dry run creates simulated messages and never marks them sent', async () => {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'live', 1, '[]', 'ml')
    `).run();

    const payload = makeWebhookPayload('919876543210', 'price', 'wamid.DRY_RUN_TEST');
    const sig = await generateHmac(appSecret, payload);

    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      getEnv()
    );

    const reply = db.prepare("SELECT * FROM messages WHERE direction = 'outbound'").get() as any;
    assert.ok(reply, 'Simulated reply row must exist');
    assert.equal(reply.is_simulated, 1);
    assert.equal(reply.delivery_status, 'simulated');
    assert.ok(reply.body.startsWith('[SIMULATED AUTO-REPLY]'));
    assert.equal(reply.provider_message_id, null);
  });

  test('Language selection detects Malayalam script vs Latin script', async () => {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'live', 1, '[]', 'en')
    `).run();

    // 1. Malayalam keyword 'വില'
    const mlPayload = makeWebhookPayload('919876543210', 'ചികിത്സയുടെ വില എത്രയാണ്?', 'wamid.LANG_ML');
    const mlSig = await generateHmac(appSecret, mlPayload);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': mlSig }, body: mlPayload },
      getEnv()
    );

    const mlReply = db.prepare("SELECT * FROM messages WHERE direction = 'outbound' AND body LIKE '%വില 500%'").get() as any;
    assert.ok(mlReply, 'Malayalam script must select Malayalam response');

    // 2. English keyword 'price'
    const enPayload = makeWebhookPayload('919876543211', 'what is the price?', 'wamid.LANG_EN');
    const enSig = await generateHmac(appSecret, enPayload);
    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': enSig }, body: enPayload },
      getEnv()
    );

    const enReply = db.prepare("SELECT * FROM messages WHERE direction = 'outbound' AND body LIKE '%Price starts%'").get() as any;
    assert.ok(enReply, 'Latin script must select English response');
  });

  test('Handover pause prevents auto-replies when human agent is requested', async () => {
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES ('ten_01', 'live', 1, '[]', 'ml')
    `).run();

    // Pre-create conversation in 'human_requested' state
    const hash = await computeKeyedLookupHash('919800000000', lookupSecret);
    db.prepare(`
      INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash, phone_number_masked)
      VALUES ('cnt_handover', 'ten_01', 'whatsapp', 'v1:a:b', ?, '+91 98**** 0000')
    `).run(hash);
    db.prepare(`
      INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id, handover_state)
      VALUES ('conv_handover', 'ten_01', 'conn_1', 'cnt_handover', 'human_requested')
    `).run();

    const payload = makeWebhookPayload('919800000000', 'price', 'wamid.HANDOVER_TEST');
    const sig = await generateHmac(appSecret, payload);

    await honoApp.request(
      'http://localhost/api/v1/webhooks/whatsapp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload },
      getEnv()
    );

    const replies = db.prepare("SELECT * FROM messages WHERE direction = 'outbound'").all();
    assert.equal(replies.length, 0, 'No replies must be sent when handover_state != bot');
  });
});
