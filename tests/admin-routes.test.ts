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

const ADMIN_PASSWORD = 'test-admin-pass-123';
const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function adminEnv(db: DatabaseSync, overrides: Record<string, any> = {}) {
  return {
    DB: createTestD1(db),
    ADMIN_PASSWORD: ADMIN_PASSWORD,
    ENCRYPTION_KEY: ENCRYPTION_KEY,
    LOOKUP_HASH_SECRET: 'a'.repeat(64),
    ...overrides
  };
}

async function get(path: string, db: DatabaseSync, envOverrides: Record<string, any> = {}, headers: Record<string, string> = {}) {
  return honoApp.request(path, { method: 'GET', headers }, adminEnv(db, envOverrides));
}

async function send(path: string, method: string, body: any, db: DatabaseSync, headers: Record<string, string> = {}) {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': ADMIN_PASSWORD, ...headers }
  };
  if (method !== 'GET' && body !== null && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return honoApp.request(path, init, adminEnv(db));
}

describe('Admin API Tests (Dashboard Backend)', () => {
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
      VALUES ('conv_1', 'ten_admin', 'conn_wa', 'cnt_1', 'bot', 'Hello there', 1)
    `).run();
    db.prepare(`
      INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, provider_message_id, body, delivery_status)
      VALUES ('msg_in_1', 'ten_admin', 'conv_1', 'conn_wa', 'inbound', 'customer', 'text', 'wamid.X1', 'Hello there', 'delivered')
    `).run();
  });

  describe('Authentication Guard (Fail-Closed)', () => {
    test('Returns 503 when ADMIN_PASSWORD secret is not configured', async () => {
      const res = await get('/api/v1/admin/session', db, { ADMIN_PASSWORD: undefined as any });
      assert.equal(res.status, 503);
    });

    test('Returns 401 when password header is missing', async () => {
      const res = await get('/api/v1/admin/session', db);
      assert.equal(res.status, 401);
    });

    test('Returns 401 when password is wrong', async () => {
      const res = await get('/api/v1/admin/session', db, {}, { 'X-Admin-Password': 'wrong-pass' });
      assert.equal(res.status, 401);
    });

    test('Returns 200 with correct password', async () => {
      const res = await get('/api/v1/admin/session', db, {}, { 'X-Admin-Password': ADMIN_PASSWORD });
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body.ok, true);
    });
  });

  describe('Overview & Settings', () => {
    test('Overview returns dashboard counters', async () => {
      const res = await send('/api/v1/admin/overview', 'GET', null, db).then(r => r);
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.stats.active_accounts, 1);
      assert.equal(body.stats.total_conversations, 1);
      assert.equal(body.stats.total_inbound, 1);
    });

    test('GET settings returns seeded tenant settings', async () => {
      const res = await send('/api/v1/admin/settings', 'GET', null, db);
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body.settings.automation_mode, 'test');
      assert.equal(body.settings.default_language, 'ml');
    });

    test('PUT settings updates values and rejects invalid mode', async () => {
      const ok = await send('/api/v1/admin/settings', 'PUT', { automation_mode: 'live', dry_run: 0 }, db);
      assert.equal(ok.status, 200);
      const updated: any = await ok.json();
      assert.equal(updated.settings.automation_mode, 'live');
      assert.equal(updated.settings.dry_run, 0);

      const bad = await send('/api/v1/admin/settings', 'PUT', { automation_mode: 'turbo' }, db);
      assert.equal(bad.status, 400);
    });

    test('PUT settings validates business hours', async () => {
      const bad = await send('/api/v1/admin/settings', 'PUT', { business_hours_json: { startHour: 20, endHour: 9 } }, db);
      assert.equal(bad.status, 400);
    });
  });

  describe('Rules CRUD', () => {
    test('POST creates rule with new object config format', async () => {
      const res = await send('/api/v1/admin/rules', 'POST', {
        name: 'Price Rule',
        channel_type: 'whatsapp',
        trigger_type: 'keyword',
        trigger_config_json: { keywords: ['price', 'വില'], match: 'contains' },
        response_content_json: { en: 'Price is 100', ml: 'വില 100' },
        priority: 10
      }, db);
      assert.equal(res.status, 201);
      const body: any = await res.json();
      assert.equal(body.rule.name, 'Price Rule');
    });

    test('POST creates rule with legacy array config', async () => {
      const res = await send('/api/v1/admin/rules', 'POST', {
        name: 'Legacy Rule',
        channel_type: 'instagram',
        trigger_type: 'keyword_contains',
        trigger_config_json: ['dm', 'inbox'],
        response_content_json: { en: 'Checking DMs' },
        priority: 5
      }, db);
      assert.equal(res.status, 201);
    });

    test('POST rejects invalid channel_type and empty responses', async () => {
      const badChannel = await send('/api/v1/admin/rules', 'POST', {
        name: 'X', channel_type: 'telegram', trigger_type: 'keyword_contains',
        trigger_config_json: ['hi'], response_content_json: { en: 'hi' }
      }, db);
      assert.equal(badChannel.status, 400);

      const badContent = await send('/api/v1/admin/rules', 'POST', {
        name: 'Y', channel_type: 'whatsapp', trigger_type: 'keyword_contains',
        trigger_config_json: ['hi'], response_content_json: { en: '   ' }
      }, db);
      assert.equal(badContent.status, 400);
    });

    test('GET lists rules, PUT updates, DELETE removes', async () => {
      const created = await send('/api/v1/admin/rules', 'POST', {
        name: 'Update Me',
        channel_type: 'whatsapp',
        trigger_type: 'keyword_exact',
        trigger_config_json: ['hello'],
        response_content_json: { en: 'Hi!' },
        priority: 1
      }, db);
      const { rule } = await created.json() as any;

      const list = await send('/api/v1/admin/rules', 'GET', null, db);
      const listBody: any = await list.json();
      assert.equal(listBody.rules.length, 1);

      const put = await send(`/api/v1/admin/rules/${rule.id}`, 'PUT', {
        name: 'Updated Name',
        channel_type: 'whatsapp',
        trigger_type: 'keyword_exact',
        trigger_config_json: ['hello'],
        response_content_json: { en: 'Hi!', ml: 'ഹായ്' },
        priority: 2,
        is_active: 0
      }, db);
      assert.equal(put.status, 200);
      const putBody: any = await put.json();
      assert.equal(putBody.rule.name, 'Updated Name');
      assert.equal(putBody.rule.is_active, 0);

      const del = await send(`/api/v1/admin/rules/${rule.id}`, 'DELETE', null, db);
      assert.equal(del.status, 200);
      const list2: any = await (await send('/api/v1/admin/rules', 'GET', null, db)).json();
      assert.equal(list2.rules.length, 0);
    });
  });

  describe('Accounts (channel_connections)', () => {
    test('POST stores access token ENCRYPTED, never plaintext', async () => {
      const res = await send('/api/v1/admin/accounts', 'POST', {
        channel_type: 'instagram',
        account_id: '17841400000000001',
        name: 'My IG',
        access_token: 'IGQVJTESTTOKEN123456'
      }, db);
      assert.equal(res.status, 201);

      const row = db.prepare("SELECT encrypted_access_token, token_preview FROM channel_connections WHERE account_id = '17841400000000001'").get() as any;
      assert.ok(row.encrypted_access_token.startsWith('v1:'), 'token must be AES-GCM encrypted');
      assert.ok(!row.encrypted_access_token.includes('IGQVJTESTTOKEN123456'), 'plaintext token must never be stored');
      assert.equal(row.token_preview, '...3456');
    });

    test('GET accounts never exposes encrypted tokens', async () => {
      await send('/api/v1/admin/accounts', 'POST', {
        channel_type: 'messenger', account_id: 'page_001', name: 'FB Page', access_token: 'EAABPAGESECRET123'
      }, db);
      const res = await send('/api/v1/admin/accounts', 'GET', null, db);
      const body: any = await res.json();
      assert.equal(body.accounts.length, 2);
      for (const acc of body.accounts) {
        assert.equal(acc.encrypted_access_token, undefined);
        assert.equal(acc.access_token, undefined);
      }
    });

    test('POST duplicate channel+account returns 409', async () => {
      await send('/api/v1/admin/accounts', 'POST', {
        channel_type: 'instagram', account_id: 'dup_001', name: 'One', access_token: 'TOKEN000000001'
      }, db);
      const dup = await send('/api/v1/admin/accounts', 'POST', {
        channel_type: 'instagram', account_id: 'dup_001', name: 'Two', access_token: 'TOKEN000000002'
      }, db);
      assert.equal(dup.status, 409);
    });

    test('POST rejects missing token and invalid channel', async () => {
      const noToken = await send('/api/v1/admin/accounts', 'POST', { channel_type: 'instagram', account_id: 'x1' }, db);
      assert.equal(noToken.status, 400);
      const badChannel = await send('/api/v1/admin/accounts', 'POST', { channel_type: 'tiktok', account_id: 'x1', access_token: 'TOKEN123456789' }, db);
      assert.equal(badChannel.status, 400);
    });

    test('DELETE removes account', async () => {
      const created = await send('/api/v1/admin/accounts', 'POST', {
        channel_type: 'whatsapp', account_id: 'del_001', name: 'Temp', access_token: 'TOKENDEL0011234'
      }, db);
      const { account } = await created.json() as any;
      const del = await send(`/api/v1/admin/accounts/${account.id}`, 'DELETE', null, db);
      assert.equal(del.status, 200);
      const count = db.prepare("SELECT COUNT(*) AS c FROM channel_connections WHERE account_id = 'del_001'").get() as any;
      assert.equal(count.c, 0);
    });
  });

  describe('Conversations & Handover', () => {
    test('GET conversations lists with contact info', async () => {
      const res = await send('/api/v1/admin/conversations', 'GET', null, db);
      const body: any = await res.json();
      assert.equal(body.conversations.length, 1);
      assert.equal(body.conversations[0].display_name, 'Rinshad');
      assert.equal(body.conversations[0].channel_type, 'whatsapp');
    });

    test('GET conversations filters by channel', async () => {
      const res = await send('/api/v1/admin/conversations?channel=instagram', 'GET', null, db);
      const body: any = await res.json();
      assert.equal(body.conversations.length, 0);
    });

    test('GET conversation messages returns thread', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/messages', 'GET', null, db);
      const body: any = await res.json();
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].body, 'Hello there');
    });

    test('Handover toggle updates handover_state', async () => {
      const res = await send('/api/v1/admin/conversations/conv_1/handover', 'POST', { state: 'human_requested' }, db);
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT handover_state FROM conversations WHERE id = 'conv_1'").get() as any;
      assert.equal(row.handover_state, 'human_requested');

      const bad = await send('/api/v1/admin/conversations/conv_1/handover', 'POST', { state: 'chaos' }, db);
      assert.equal(bad.status, 400);
    });

    test('Tenant isolation: admin routes never touch other tenants', async () => {
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_other', 'Other', 'other')").run();
      db.prepare(`
        INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id, handover_state)
        VALUES ('conv_other', 'ten_other', 'conn_wa', 'cnt_1', 'bot')
      `).run();

      const res = await send('/api/v1/admin/conversations', 'GET', null, db);
      const body: any = await res.json();
      assert.equal(body.conversations.filter((c: any) => c.id === 'conv_other').length, 0);

      const res2 = await send('/api/v1/admin/conversations/conv_other/handover', 'POST', { state: 'human_requested' }, db);
      assert.equal(res2.status, 404);
    });
  });
});
