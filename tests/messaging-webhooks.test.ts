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

const APP_SECRET = 'messaging_test_secret';
const VERIFY_TOKEN = 'messaging_test_verify';
const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

async function generateHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function messagingEnv(db: DatabaseSync, overrides: Record<string, any> = {}) {
  return {
    DB: createTestD1(db),
    META_APP_SECRET: APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    ENCRYPTION_KEY: ENCRYPTION_KEY,
    LOOKUP_HASH_SECRET: 'b'.repeat(64),
    ...overrides
  };
}

function buildPayload(objectType: string, accountId: string, items: any[]) {
  return JSON.stringify({
    object: objectType,
    entry: [{ id: accountId, messaging: items }]
  });
}

describe('Facebook & Instagram Messaging Webhook Tests', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8'));
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8'));
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8'));

    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_msg', 'Messaging Tenant', 'msg-t')").run();
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language, handover_timeout_minutes, business_hours_json)
      VALUES ('ten_msg', 'live', 1, '[]', 'ml', NULL, NULL)
    `).run();
    db.prepare(`
      INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token, status)
      VALUES ('conn_ig', 'ten_msg', 'instagram', '17841400000000IG', 'IG Main', 'v1:iv:ct', '...ABCD', 'tok', 'active')
    `).run();
    db.prepare(`
      INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token, status)
      VALUES ('conn_fb', 'ten_msg', 'messenger', '1122334455FBPAGE', 'FB Page', 'v1:iv:ct', '...EFGH', 'tok', 'active')
    `).run();

    db.prepare(`
      INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
      VALUES ('rule_ig_price', 'ten_msg', 'IG Price', 'instagram', 'keyword_contains', '["price","വില"]', 'text', '{"en":"Our price list is here!","ml":"ഞങ്ങളുടെ വില പട്ടിക ഇതാ!"}', 10, 1)
    `).run();
    db.prepare(`
      INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
      VALUES ('rule_fb_greet', 'ten_msg', 'FB Greeting', 'messenger', 'keyword_contains', '["hello"]', 'text', '{"en":"Hi there! How can we help?","ml":"ഹായ്! എങ്ങനെ സഹായിക്കാം?"}', 10, 1)
    `).run();
    db.prepare(`
      INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
      VALUES ('rule_wa_only', 'ten_msg', 'WA Only Rule', 'whatsapp', 'keyword_contains', '["price"]', 'text', '{"en":"WA ONLY"}', 20, 1)
    `).run();
  });

  describe('GET Verification Handshake', () => {
    test('Instagram challenge returns 200 with correct token', async () => {
      const res = await honoApp.request(
        '/api/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=messaging_test_verify&hub.challenge=777',
        { method: 'GET' }, messagingEnv(db)
      );
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '777');
    });

    test('Facebook challenge returns 200 with correct token', async () => {
      const res = await honoApp.request(
        '/api/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=messaging_test_verify&hub.challenge=888',
        { method: 'GET' }, messagingEnv(db)
      );
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '888');
    });

    test('Returns 403 on wrong verify token', async () => {
      const res = await honoApp.request(
        '/api/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1',
        { method: 'GET' }, messagingEnv(db)
      );
      assert.equal(res.status, 403);
    });
  });

  describe('Instagram Ingestion & Auto-Reply', () => {
    test('Valid HMAC POST stores message, event processed, simulated reply sent', async () => {
      const payload = buildPayload('instagram', '17841400000000IG', [
        { sender: { id: 'IGSID99999' }, recipient: { id: '17841400000000IG' }, timestamp: Date.now(), message: { mid: 'ig_mid_001', text: 'What is the price?' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'EVENT_RECEIVED');

      const inbound = db.prepare("SELECT * FROM messages WHERE provider_message_id = 'ig_mid_001'").get() as any;
      assert.ok(inbound, 'inbound message stored');
      assert.equal(inbound.direction, 'inbound');
      assert.equal(inbound.body, 'What is the price?');

      const contact = db.prepare("SELECT channel_type, phone_number_masked FROM contacts WHERE tenant_id = 'ten_msg'").get() as any;
      assert.equal(contact.channel_type, 'instagram');
      assert.ok(contact.phone_number_masked.includes('****'), 'sender id must be masked');

      const simulated = db.prepare("SELECT * FROM messages WHERE direction = 'outbound' AND is_simulated = 1").get() as any;
      assert.ok(simulated, 'simulated reply stored (dry_run=1)');
      assert.ok(simulated.body.includes('price list'), 'English reply chosen for English inbound text');
      assert.equal(simulated.in_reply_to_message_id, inbound.id);

      const event = db.prepare("SELECT processing_status FROM webhook_events WHERE dedupe_key = 'ig_mid_001'").get() as any;
      assert.equal(event.processing_status, 'processed');
    });

    test('Channel isolation: Instagram message does NOT fire WhatsApp-only rule', async () => {
      const payload = buildPayload('instagram', '17841400000000IG', [
        { sender: { id: 'IGSID77777' }, recipient: { id: '17841400000000IG' }, timestamp: Date.now(), message: { mid: 'ig_mid_002', text: 'price please' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));

      const replies = db.prepare("SELECT body FROM messages WHERE direction = 'outbound'").all() as any[];
      assert.equal(replies.length, 1);
      assert.ok(replies[0].body.includes('IG Price') === false);
      assert.ok(replies[0].body.includes('price list'), 'instagram rule fired, not the higher-priority WA rule');
    });

    test('Unregistered Instagram account_id is skipped without 500 (Bug 2 pattern)', async () => {
      const payload = buildPayload('instagram', 'UNKNOWN_IG_ACCOUNT', [
        { sender: { id: 'IGSID00001' }, recipient: { id: 'UNKNOWN_IG_ACCOUNT' }, timestamp: Date.now(), message: { mid: 'ig_mid_003', text: 'hello?' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 200);
      const count = db.prepare('SELECT COUNT(*) AS c FROM webhook_events').get() as any;
      assert.equal(count.c, 0);
    });

    test('Echo messages (our own sends) are ignored', async () => {
      const payload = buildPayload('instagram', '17841400000000IG', [
        { sender: { id: '17841400000000IG' }, recipient: { id: 'IGSID99999' }, timestamp: Date.now(), message: { mid: 'ig_mid_echo', text: 'we sent this', is_echo: true } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 200);
      const count = db.prepare('SELECT COUNT(*) AS c FROM messages').get() as any;
      assert.equal(count.c, 0);
    });

    test('Duplicate mid within one batch: new events still processed (Bug 1 pattern)', async () => {
      const payload = buildPayload('instagram', '17841400000000IG', [
        { sender: { id: 'IGSID55555' }, recipient: { id: '17841400000000IG' }, timestamp: Date.now(), message: { mid: 'ig_mid_dup', text: 'hi dup' } },
        { sender: { id: 'IGSID55555' }, recipient: { id: '17841400000000IG' }, timestamp: Date.now(), message: { mid: 'ig_mid_new', text: 'price check' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 200);

      const dupRow = db.prepare("SELECT COUNT(*) AS c FROM webhook_events WHERE dedupe_key = 'ig_mid_dup'").get() as any;
      assert.equal(dupRow.c, 1, 'duplicate stored once');
      const newRow = db.prepare("SELECT COUNT(*) AS c FROM webhook_events WHERE dedupe_key = 'ig_mid_new'").get() as any;
      assert.equal(newRow.c, 1, 'new event in same batch is NOT lost');
    });

    test('PII guard: raw preview contains no run of 6+ digits (Bug 5 pattern)', async () => {
      const payload = buildPayload('instagram', '17841400000000IG', [
        { sender: { id: 'IGSID424242' }, recipient: { id: '17841400000000IG' }, timestamp: 1770000000000, message: { mid: 'ig_mid_pii', text: 'my id is 919876543210' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      await honoApp.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));

      const ev = db.prepare("SELECT raw_payload_preview FROM webhook_events WHERE dedupe_key = 'ig_mid_pii'").get() as any;
      assert.ok(!/\d{6,}/.test(ev.raw_payload_preview), 'no 6+ digit run allowed');
    });
  });

  describe('Facebook Messenger Ingestion & Auto-Reply', () => {
    test('Valid HMAC POST stores message and fires messenger rule', async () => {
      const payload = buildPayload('page', '1122334455FBPAGE', [
        { sender: { id: 'PSID88888' }, recipient: { id: '1122334455FBPAGE' }, timestamp: Date.now(), message: { mid: 'fb_mid_001', text: 'hello there' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 200);

      const inbound = db.prepare("SELECT * FROM messages WHERE provider_message_id = 'fb_mid_001'").get() as any;
      assert.ok(inbound, 'inbound message stored');
      assert.equal(inbound.body, 'hello there');

      const contact = db.prepare("SELECT channel_type FROM contacts WHERE tenant_id = 'ten_msg' AND channel_type = 'messenger'").get() as any;
      assert.ok(contact, 'contact stored with messenger channel');

      const simulated = db.prepare("SELECT body FROM messages WHERE direction = 'outbound' AND is_simulated = 1").get() as any;
      assert.ok(simulated, 'simulated reply stored');
      assert.ok(simulated.body.includes('Hi there') || simulated.body.includes('ഹായ്'), 'messenger greeting rule fired');
    });

    test('Invalid HMAC returns 401 and writes nothing', async () => {
      const payload = buildPayload('page', '1122334455FBPAGE', [
        { sender: { id: 'PSID1' }, recipient: { id: '1122334455FBPAGE' }, timestamp: Date.now(), message: { mid: 'fb_mid_bad', text: 'x' } }
      ]);
      const res = await honoApp.request('/api/v1/webhooks/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
        body: payload
      }, messagingEnv(db));
      assert.equal(res.status, 401);
      const count = db.prepare('SELECT COUNT(*) AS c FROM webhook_events').get() as any;
      assert.equal(count.c, 0);
    });

    test('Missing secrets fail closed with 500 (Bug 4 pattern)', async () => {
      const payload = buildPayload('page', '1122334455FBPAGE', [
        { sender: { id: 'PSID2' }, recipient: { id: '1122334455FBPAGE' }, timestamp: Date.now(), message: { mid: 'fb_mid_nsec', text: 'x' } }
      ]);
      const sig = await generateHmac(APP_SECRET, payload);
      const res = await honoApp.request('/api/v1/webhooks/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body: payload
      }, messagingEnv(db, { ENCRYPTION_KEY: 'not-valid-base64!!' }));
      assert.equal(res.status, 500);
    });

    test('Malformed JSON returns 400', async () => {
      const body = '{not json';
      const sig = await generateHmac(APP_SECRET, body);
      const res = await honoApp.request('/api/v1/webhooks/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
        body
      }, messagingEnv(db));
      assert.equal(res.status, 400);
    });
  });
});
