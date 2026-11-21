/**
 * Phase 3 (Dashboard UI Backend) Tests
 * Covers: staff reply endpoint (simulated + real dispatch), mark-as-read,
 * account updates, webhook-info, contacts directory, 7-day stats series.
 */
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { honoApp } from '../apps/api/src/index.ts';
import { encryptAesGcm } from '../apps/api/src/services/crypto.ts';

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

const ADMIN_PASSWORD = 'test-admin-pass-123';
const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function env(db: DatabaseSync, overrides: Record<string, any> = {}) {
  return {
    DB: createTestD1(db),
    ADMIN_PASSWORD,
    ENCRYPTION_KEY,
    LOOKUP_HASH_SECRET: 'a'.repeat(64),
    ...overrides
  };
}

async function get(path: string, db: DatabaseSync, overrides: Record<string, any> = {}) {
  return honoApp.request(path, { method: 'GET', headers: { 'X-Admin-Password': ADMIN_PASSWORD } }, env(db, overrides));
}

async function send(path: string, method: string, body: any, db: DatabaseSync, overrides: Record<string, any> = {}) {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': ADMIN_PASSWORD }
  };
  if (method !== 'GET' && body !== null && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return honoApp.request(path, init, env(db, overrides));
}

describe('Phase 3 Dashboard Backend Tests', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8'));
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8'));
    db.exec(readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8'));

    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_admin', 'Admin Tenant', 'admin-t')").run();
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language, handover_timeout_minutes, business_hours_json)
      VALUES ('ten_admin', 'test', 1, '["919999888877"]', 'ml', 30, '{"startHour":9,"endHour":18,"timezone":"Asia/Kolkata"}')
    `).run();
    db.prepare(`
      INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token, status)
      VALUES ('conn_wa', 'ten_admin', 'whatsapp', '111222333', 'WA Main', 'v1:iv:ct', 'EAAx', 'tok', 'active')
    `).run();
    db.prepare(`
      INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash, phone_number_masked, display_name)
      VALUES ('cnt_1', 'ten_admin', 'whatsapp', 'v1:e:f', 'hash_1', '+91 98**** 1234', 'Rinshad')
    `).run();
    db.prepare(`
      INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id, handover_state, last_message_preview, unread_count)
      VALUES ('conv_1', 'ten_admin', 'conn_wa', 'cnt_1', 'human_requested', 'Hello there', 2)
    `).run();
    db.prepare(`
      INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, provider_message_id, body, delivery_status)
      VALUES ('msg_in_1', 'ten_admin', 'conv_1', 'conn_wa', 'inbound', 'customer', 'text', 'wamid.X1', 'Hello there', 'delivered')
    `).run();
  });

  describe('POST /conversations/:id/read', () => {
    test('Resets unread_count to zero', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/read', 'POST', {}, db);
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT unread_count FROM conversations WHERE id = 'conv_1'").get() as any;
      assert.equal(row.unread_count, 0);
    });

    test('Returns 404 for unknown conversation', async () => {
      const res = await send('/api/v1/admin/conversations/conv_missing/read', 'POST', {}, db);
      assert.equal(res.status, 404);
    });
  });

  describe('POST /conversations/:id/reply (simulated dry-run)', () => {
    test('Inserts simulated human_agent reply and assigns handover', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'Sure, I will help you now' }, db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.simulated, true);

      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(json.message.id) as any;
      assert.equal(row.sender_type, 'human_agent');
      assert.equal(row.is_simulated, 1);
      assert.equal(row.delivery_status, 'simulated');
      assert.ok(row.body.includes('[SIMULATED STAFF REPLY]'));
      assert.ok(row.body.includes('Sure, I will help you now'));

      const conv = db.prepare("SELECT handover_state, unread_count, last_message_preview FROM conversations WHERE id = 'conv_1'").get() as any;
      assert.equal(conv.handover_state, 'human_assigned');
      assert.equal(conv.unread_count, 0);
      assert.equal(conv.last_message_preview, 'Sure, I will help you now');
    });

    test('Rejects empty text with 400', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: '   ' }, db);
      assert.equal(res.status, 400);
    });

    test('Rejects oversized text with 400', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'x'.repeat(4097) }, db);
      assert.equal(res.status, 400);
    });

    test('Returns 404 for unknown conversation', async () => {
      const res = await send('/api/v1/admin/conversations/conv_missing/reply', 'POST', { text: 'hi' }, db);
      assert.equal(res.status, 404);
    });

    test('Returns 409 when channel account is disconnected', async () => {
      db.prepare("UPDATE channel_connections SET status = 'disconnected' WHERE id = 'conn_wa'").run();
      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'hi' }, db);
      assert.equal(res.status, 409);
    });
  });

  describe('POST /conversations/:id/reply (real dispatch)', () => {
    const realFetch = globalThis.fetch;
    after(() => {
      globalThis.fetch = realFetch;
    });

    test('Dispatches via WhatsApp adapter and records sent status', async () => {
      // Seed valid encrypted credentials with the test ENCRYPTION_KEY
      const encToken = await encryptAesGcm('EAAG-test-token-1234567890', ENCRYPTION_KEY);
      const encRecipient = await encryptAesGcm('919876543210', ENCRYPTION_KEY);
      db.prepare("UPDATE channel_connections SET encrypted_access_token = ? WHERE id = 'conn_wa'").run(encToken);
      db.prepare("UPDATE contacts SET encrypted_platform_sender_id = ? WHERE id = 'cnt_1'").run(encRecipient);
      db.prepare("UPDATE tenant_settings SET dry_run = 0 WHERE tenant_id = 'ten_admin'").run();

      // Mock global fetch to simulate a successful Meta Graph API response
      let calledUrl = '';
      let calledAuth = '';
      (globalThis as any).fetch = async (url: any, init: any) => {
        calledUrl = String(url);
        calledAuth = init.headers.Authorization;
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'Real staff reply' }, db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.simulated, false);

      assert.ok(calledUrl.includes('/111222333/messages'), 'should POST to phone_number_id messages endpoint');
      assert.equal(calledAuth, 'Bearer EAAG-test-token-1234567890');

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(json.message.id) as any;
      assert.equal(row.sender_type, 'human_agent');
      assert.equal(row.delivery_status, 'sent');
      assert.equal(row.provider_message_id, 'wamid.TEST123');
      assert.equal(row.body, 'Real staff reply');
      assert.equal(row.is_simulated, 0);
    });

    test('Records failed dispatch with plain-language Meta error', async () => {
      const encToken = await encryptAesGcm('EAAG-test-token-1234567890', ENCRYPTION_KEY);
      const encRecipient = await encryptAesGcm('919876543210', ENCRYPTION_KEY);
      db.prepare("UPDATE channel_connections SET encrypted_access_token = ? WHERE id = 'conn_wa'").run(encToken);
      db.prepare("UPDATE contacts SET encrypted_platform_sender_id = ? WHERE id = 'cnt_1'").run(encRecipient);
      db.prepare("UPDATE tenant_settings SET dry_run = 0 WHERE tenant_id = 'ten_admin'").run();

      (globalThis as any).fetch = async () =>
        new Response(JSON.stringify({ error: { code: 131047, message: 're-engagement' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });

      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'Outside window' }, db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(json.message.id) as any;
      assert.equal(row.delivery_status, 'failed');
      assert.ok(row.error_message.includes('24'));
      assert.ok(row.error_message.includes('window') || row.error_message.includes('window expired'.split(' ')[0]));
    });

    test('Returns 500 when stored credentials cannot be decrypted', async () => {
      db.prepare("UPDATE tenant_settings SET dry_run = 0 WHERE tenant_id = 'ten_admin'").run();
      // Fixture has corrupt 'v1:iv:ct' ciphertext
      const res = await send('/api/v1/admin/conversations/conv_1/reply', 'POST', { text: 'hi' }, db);
      assert.equal(res.status, 500);
      const json: any = await res.json();
      assert.ok(json.error.includes('decrypt'));
    });
  });

  describe('PUT /accounts/:id', () => {
    test('Renames an account', async () => {
      const res = await send('/api/v1/admin/accounts/conn_wa', 'PUT', { name: 'Clinic WhatsApp' }, db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.account.name, 'Clinic WhatsApp');
    });

    test('Rotates access token and updates preview only', async () => {
      const res = await send('/api/v1/admin/accounts/conn_wa', 'PUT', { access_token: 'EAAG-NEW-TOKEN-abcdef9876' }, db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.account.token_preview, '...9876');
      // Raw token must never be returned
      assert.equal(JSON.stringify(json).includes('EAAG-NEW-TOKEN-abcdef9876'), false);
      const row = db.prepare("SELECT encrypted_access_token FROM channel_connections WHERE id = 'conn_wa'").get() as any;
      assert.ok(row.encrypted_access_token.startsWith('v1:'));
      assert.notEqual(row.encrypted_access_token, 'v1:iv:ct');
    });

    test('Disconnects an account', async () => {
      const res = await send('/api/v1/admin/accounts/conn_wa', 'PUT', { status: 'disconnected' }, db);
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT status FROM channel_connections WHERE id = 'conn_wa'").get() as any;
      assert.equal(row.status, 'disconnected');
    });

    test('Rejects invalid status', async () => {
      const res = await send('/api/v1/admin/accounts/conn_wa', 'PUT', { status: 'paused' }, db);
      assert.equal(res.status, 400);
    });

    test('Rejects short access token', async () => {
      const res = await send('/api/v1/admin/accounts/conn_wa', 'PUT', { access_token: 'short' }, db);
      assert.equal(res.status, 400);
    });

    test('Returns 404 for unknown account', async () => {
      const res = await send('/api/v1/admin/accounts/conn_missing', 'PUT', { name: 'X' }, db);
      assert.equal(res.status, 404);
    });
  });

  describe('GET /webhook-info', () => {
    test('Returns per-channel callback URLs and secret presence flags', async () => {
      const res = await get('/api/v1/admin/webhook-info', db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.webhooks.whatsapp, 'http://localhost/api/v1/webhooks/whatsapp');
      assert.equal(json.webhooks.instagram, 'http://localhost/api/v1/webhooks/instagram');
      assert.equal(json.webhooks.messenger, 'http://localhost/api/v1/webhooks/facebook');
      assert.equal(json.verifyTokenConfigured, false);
      assert.equal(json.appSecretConfigured, false);
    });

    test('Reports configured secrets as present without leaking values', async () => {
      const res = await get('/api/v1/admin/webhook-info', db, {
        META_WEBHOOK_VERIFY_TOKEN: 'super-secret-verify-token',
        META_APP_SECRET: 'super-secret-app-secret'
      });
      const json: any = await res.json();
      assert.equal(json.verifyTokenConfigured, true);
      assert.equal(json.appSecretConfigured, true);
      const body = JSON.stringify(json);
      assert.equal(body.includes('super-secret'), false);
    });
  });

  describe('GET /contacts', () => {
    test('Lists contacts with counts and masked PII only', async () => {
      const res = await get('/api/v1/admin/contacts', db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.contacts.length, 1);
      const ct = json.contacts[0];
      assert.equal(ct.display_name, 'Rinshad');
      assert.equal(ct.phone_number_masked, '+91 98**** 1234');
      assert.equal(ct.conversation_count, 1);
      assert.ok(ct.last_message_at);
      // Encrypted PII must never be exposed
      const body = JSON.stringify(json);
      assert.equal(body.includes('encrypted_platform_sender_id'), false);
      assert.equal(body.includes('v1:e:f'), false);
    });
  });

  describe('GET /stats/daily', () => {
    test('Returns exactly 7 day buckets with zeros filled', async () => {
      const res = await get('/api/v1/admin/stats/daily', db);
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.equal(json.series.length, 7);

      const today = new Date().toISOString().slice(0, 10);
      const lastDay = json.series[json.series.length - 1];
      assert.equal(lastDay.day, today);
      assert.equal(lastDay.inbound, 1);

      const total = json.series.reduce((acc: number, d: any) => acc + d.inbound + d.outbound, 0);
      assert.equal(total, 1);
    });

    test('Is tenant-scoped: other tenant rows are excluded', async () => {
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_other', 'Other', 'other')").run();
      db.prepare(`
        INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash, phone_number_masked, display_name)
        VALUES ('cnt_other', 'ten_other', 'whatsapp', 'v1:o:t', 'hash_other', '+91 97**** 9999', 'Outsider')
      `).run();
      db.prepare(`
        INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id, handover_state, last_message_preview, unread_count)
        VALUES ('conv_other', 'ten_other', 'conn_wa', 'cnt_other', 'bot', 'foreign msg', 1)
      `).run();
      db.prepare(`
        INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, provider_message_id, body, delivery_status)
        VALUES ('msg_other', 'ten_other', 'conv_other', 'conn_wa', 'inbound', 'customer', 'text', 'wamid.OTHER', 'foreign', 'delivered')
      `).run();
      const res = await get('/api/v1/admin/stats/daily', db);
      const json: any = await res.json();
      const total = json.series.reduce((acc: number, d: any) => acc + d.inbound + d.outbound, 0);
      assert.equal(total, 1);
    });
  });
});
