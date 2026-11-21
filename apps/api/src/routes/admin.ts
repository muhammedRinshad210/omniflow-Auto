import { Hono } from 'hono';
import { timingSafeStringEqual, encryptAesGcm, decryptAesGcm } from '../services/crypto.ts';
import { sendWhatsAppTextMessage } from '../adapters/whatsapp/client.ts';
import { sendInstagramTextMessage } from '../adapters/instagram/client.ts';
import { sendMessengerTextMessage } from '../adapters/facebook/client.ts';
import type { Env } from '../types/env.ts';

const VALID_CHANNELS = ['whatsapp', 'instagram', 'messenger'];
const VALID_TRIGGER_TYPES = ['keyword', 'keyword_exact', 'keyword_contains', 'keyword_starts_with', 'default_fallback'];
const VALID_MATCH_MODES = ['contains', 'exact', 'starts_with'];
const VALID_MODES = ['off', 'test', 'live'];
const VALID_HANDOVER_STATES = ['bot', 'human_requested', 'human_assigned'];
const VALID_LANGUAGES = ['en', 'ml'];

function isValidEncryptionKey(key?: string): boolean {
  if (!key || typeof key !== 'string') return false;
  try {
    const raw = Uint8Array.from(atob(key.trim()), (c) => c.charCodeAt(0));
    return raw.byteLength === 32;
  } catch {
    return false;
  }
}

/** Resolves the single pilot tenant (lowest created_at). Returns null if none. */
async function getPrimaryTenant(
  db: Env['DB']
): Promise<{ id: string } | null> {
  return db
    .prepare('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1')
    .first<{ id: string }>();
}

interface RuleValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    name: string;
    channel_type: string;
    trigger_type: string;
    trigger_config_json: string;
    response_type: string;
    response_content_json: string;
    priority: number;
    is_active: number;
  };
}

function validateRulePayload(body: any): RuleValidationResult {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Body must be a JSON object' };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 100) return { valid: false, error: 'Rule name must be 1-100 characters' };

  const channelType = body.channel_type;
  if (!VALID_CHANNELS.includes(channelType)) {
    return { valid: false, error: `channel_type must be one of: ${VALID_CHANNELS.join(', ')}` };
  }

  const triggerType = body.trigger_type;
  if (!VALID_TRIGGER_TYPES.includes(triggerType)) {
    return { valid: false, error: `trigger_type must be one of: ${VALID_TRIGGER_TYPES.join(', ')}` };
  }

  let triggerConfigJson = '[]';
  if (triggerType === 'default_fallback') {
    triggerConfigJson = '[]';
  } else {
    const cfg = body.trigger_config_json;
    if (typeof cfg === 'string') {
      try {
        const parsed = JSON.parse(cfg);
        const err = validateTriggerConfig(parsed);
        if (err) return { valid: false, error: err };
        triggerConfigJson = JSON.stringify(parsed);
      } catch {
        return { valid: false, error: 'trigger_config_json must be valid JSON' };
      }
    } else if (cfg && typeof cfg === 'object') {
      const err = validateTriggerConfig(cfg);
      if (err) return { valid: false, error: err };
      triggerConfigJson = JSON.stringify(cfg);
    } else {
      return { valid: false, error: 'trigger_config_json is required for keyword rules' };
    }
  }

  let responseContentJson: string;
  if (typeof body.response_content_json === 'string') {
    responseContentJson = body.response_content_json;
    try {
      const parsed = JSON.parse(responseContentJson);
      const err = validateResponseContent(parsed);
      if (err) return { valid: false, error: err };
    } catch {
      return { valid: false, error: 'response_content_json must be valid JSON' };
    }
  } else if (body.response_content_json && typeof body.response_content_json === 'object') {
    const err = validateResponseContent(body.response_content_json);
    if (err) return { valid: false, error: err };
    responseContentJson = JSON.stringify(body.response_content_json);
  } else {
    return { valid: false, error: 'response_content_json is required' };
  }

  const priority = Number.isInteger(body.priority) ? body.priority : parseInt(String(body.priority ?? 0), 10);
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    return { valid: false, error: 'priority must be an integer between 0 and 1000' };
  }

  const isActive = body.is_active === 0 ? 0 : 1;

  return {
    valid: true,
    normalized: {
      name,
      channel_type: channelType,
      trigger_type: triggerType,
      trigger_config_json: triggerConfigJson,
      response_type: 'text',
      response_content_json: responseContentJson,
      priority,
      is_active: isActive
    }
  };
}

function validateTriggerConfig(cfg: any): string | null {
  // Legacy format: plain array of strings
  if (Array.isArray(cfg)) {
    if (cfg.length === 0 || !cfg.every((k) => typeof k === 'string' && k.trim().length > 0)) {
      return 'trigger_config_json array must contain non-empty keyword strings';
    }
    return null;
  }
  // New format: { keywords: string[], match: 'contains' | 'exact' | 'starts_with' }
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    if (!Array.isArray(cfg.keywords) || cfg.keywords.length === 0 || !cfg.keywords.every((k: any) => typeof k === 'string' && k.trim().length > 0)) {
      return 'trigger_config_json.keywords must be a non-empty array of strings';
    }
    if (cfg.match !== undefined && !VALID_MATCH_MODES.includes(cfg.match)) {
      return `trigger_config_json.match must be one of: ${VALID_MATCH_MODES.join(', ')}`;
    }
    return null;
  }
  return 'trigger_config_json must be a keyword array or { keywords, match } object';
}

function validateResponseContent(content: any): string | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return 'response_content_json must be an object like { "en": "...", "ml": "..." }';
  }
  const hasText = Object.values(content).some((v) => typeof v === 'string' && v.trim().length > 0);
  if (!hasText) return 'response_content_json must contain at least one non-empty reply text';
  return null;
}

/**
 * Admin API router for the OmniFlow dashboard.
 * Protected by a shared admin password (X-Admin-Password header).
 * Fail-closed: if ADMIN_PASSWORD secret is not configured, ALL admin routes return 503.
 */
export function createAdminRouter() {
  const router = new Hono<{ Bindings: Env }>();

  // ------------------------------------------------------------------
  // Auth guard (applies to every /api/v1/admin route)
  // ------------------------------------------------------------------
  router.use('*', async (c, next) => {
    const adminPassword = c.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return c.json({ error: 'Admin password not configured on the server. Set the ADMIN_PASSWORD secret.' }, 503);
    }

    const provided = c.req.header('X-Admin-Password') || '';
    if (!provided || !timingSafeStringEqual(provided, adminPassword)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  });

  // ------------------------------------------------------------------
  // GET /session — login validation
  // ------------------------------------------------------------------
  router.get('/session', (c) => c.json({ ok: true, app: c.env.APP_NAME || 'OmniFlow' }));

  // ------------------------------------------------------------------
  // GET /overview — dashboard summary counters
  // ------------------------------------------------------------------
  router.get('/overview', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found. Run the seed script first.' }, 404);

    const counts = await db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM channel_connections WHERE tenant_id = ? AND status = 'active') AS active_accounts,
          (SELECT COUNT(*) FROM automation_rules WHERE tenant_id = ? AND is_active = 1) AS active_rules,
          (SELECT COUNT(*) FROM conversations WHERE tenant_id = ?) AS total_conversations,
          (SELECT COUNT(*) FROM conversations WHERE tenant_id = ? AND handover_state != 'bot') AS handover_conversations,
          (SELECT COUNT(*) FROM messages WHERE tenant_id = ? AND direction = 'inbound') AS total_inbound,
          (SELECT COUNT(*) FROM messages WHERE tenant_id = ? AND direction = 'outbound' AND is_simulated = 0) AS total_outbound,
          (SELECT COUNT(*) FROM messages WHERE tenant_id = ? AND created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')) AS messages_today
      `)
      .bind(tenant.id, tenant.id, tenant.id, tenant.id, tenant.id, tenant.id, tenant.id)
      .first<any>();

    return c.json({ ok: true, tenantId: tenant.id, stats: counts });
  });

  // ------------------------------------------------------------------
  // GET /settings
  // ------------------------------------------------------------------
  router.get('/settings', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const settings = await db
      .prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?')
      .bind(tenant.id)
      .first<any>();

    return c.json({ ok: true, settings: settings || null });
  });

  // ------------------------------------------------------------------
  // PUT /settings
  // ------------------------------------------------------------------
  router.put('/settings', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    if (body.automation_mode !== undefined && !VALID_MODES.includes(body.automation_mode)) {
      return c.json({ error: `automation_mode must be one of: ${VALID_MODES.join(', ')}` }, 400);
    }
    if (body.dry_run !== undefined && ![0, 1, true, false].includes(body.dry_run)) {
      return c.json({ error: 'dry_run must be 0 or 1' }, 400);
    }
    if (body.allowlist_json !== undefined) {
      let list: any;
      try {
        list = typeof body.allowlist_json === 'string' ? JSON.parse(body.allowlist_json) : body.allowlist_json;
      } catch {
        return c.json({ error: 'allowlist_json must be valid JSON' }, 400);
      }
      if (!Array.isArray(list) || !list.every((v) => typeof v === 'string' && v.trim().length > 0)) {
        return c.json({ error: 'allowlist must be an array of non-empty strings' }, 400);
      }
    }
    if (body.default_language !== undefined && !VALID_LANGUAGES.includes(body.default_language)) {
      return c.json({ error: 'default_language must be "en" or "ml"' }, 400);
    }
    if (body.handover_timeout_minutes !== undefined && body.handover_timeout_minutes !== null) {
      const t = Number(body.handover_timeout_minutes);
      if (!Number.isInteger(t) || t < 0 || t > 10080) {
        return c.json({ error: 'handover_timeout_minutes must be an integer between 0 and 10080, or null' }, 400);
      }
    }
    if (body.business_hours_json !== undefined && body.business_hours_json !== null) {
      let bh: any;
      try {
        bh = typeof body.business_hours_json === 'string' ? JSON.parse(body.business_hours_json) : body.business_hours_json;
      } catch {
        return c.json({ error: 'business_hours_json must be valid JSON' }, 400);
      }
      const startHour = Number(bh?.startHour);
      const endHour = Number(bh?.endHour);
      if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24 || startHour >= endHour) {
        return c.json({ error: 'business_hours_json requires integer startHour < endHour (0-24)' }, 400);
      }
      if (bh.timezone !== undefined && typeof bh.timezone !== 'string') {
        return c.json({ error: 'business_hours_json.timezone must be a string' }, 400);
      }
    }

    const existing = await db
      .prepare('SELECT tenant_id FROM tenant_settings WHERE tenant_id = ?')
      .bind(tenant.id)
      .first<{ tenant_id: string }>();

    const mode = body.automation_mode ?? 'off';
    const dryRun = body.dry_run === undefined ? 1 : (body.dry_run === 1 || body.dry_run === true ? 1 : 0);
    const allowlistJson = body.allowlist_json !== undefined
      ? (typeof body.allowlist_json === 'string' ? body.allowlist_json : JSON.stringify(body.allowlist_json))
      : '[]';
    const defaultLanguage = body.default_language ?? 'ml';
    const handoverTimeout = body.handover_timeout_minutes === undefined ? null : body.handover_timeout_minutes;
    const businessHoursJson = body.business_hours_json === undefined
      ? null
      : (body.business_hours_json === null ? null : (typeof body.business_hours_json === 'string' ? body.business_hours_json : JSON.stringify(body.business_hours_json)));

    if (existing) {
      await db
        .prepare(`
          UPDATE tenant_settings
          SET automation_mode = ?, dry_run = ?, allowlist_json = ?, default_language = ?,
              handover_timeout_minutes = ?, business_hours_json = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE tenant_id = ?
        `)
        .bind(mode, dryRun, allowlistJson, defaultLanguage, handoverTimeout, businessHoursJson, tenant.id)
        .run();
    } else {
      await db
        .prepare(`
          INSERT INTO tenant_settings (
            tenant_id, automation_mode, dry_run, allowlist_json, default_language,
            handover_timeout_minutes, business_hours_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(tenant.id, mode, dryRun, allowlistJson, defaultLanguage, handoverTimeout, businessHoursJson)
        .run();
    }

    const updated = await db
      .prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?')
      .bind(tenant.id)
      .first<any>();

    return c.json({ ok: true, settings: updated });
  });

  // ------------------------------------------------------------------
  // Rules CRUD
  // ------------------------------------------------------------------
  router.get('/rules', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const result = await db
      .prepare('SELECT * FROM automation_rules WHERE tenant_id = ? ORDER BY priority DESC, created_at ASC')
      .bind(tenant.id)
      .all<any>();

    return c.json({ ok: true, rules: result.results || [] });
  });

  router.post('/rules', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const check = validateRulePayload(body);
    if (!check.valid || !check.normalized) {
      return c.json({ error: check.error }, 400);
    }

    const id = `rule_${crypto.randomUUID()}`;
    try {
      await db
        .prepare(`
          INSERT INTO automation_rules (
            id, tenant_id, name, channel_type, trigger_type, trigger_config_json,
            response_type, response_content_json, priority, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id, tenant.id, check.normalized.name, check.normalized.channel_type,
          check.normalized.trigger_type, check.normalized.trigger_config_json,
          check.normalized.response_type, check.normalized.response_content_json,
          check.normalized.priority, check.normalized.is_active
        )
        .run();
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('UNIQUE')) return c.json({ error: 'A rule with this id already exists' }, 409);
      return c.json({ error: `Failed to create rule: ${errStr}` }, 500);
    }

    const created = await db.prepare('SELECT * FROM automation_rules WHERE id = ?').bind(id).first<any>();
    return c.json({ ok: true, rule: created }, 201);
  });

  router.put('/rules/:id', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const ruleId = c.req.param('id');
    const existing = await db
      .prepare('SELECT id FROM automation_rules WHERE id = ? AND tenant_id = ?')
      .bind(ruleId, tenant.id)
      .first<{ id: string }>();
    if (!existing) return c.json({ error: 'Rule not found' }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const check = validateRulePayload(body);
    if (!check.valid || !check.normalized) {
      return c.json({ error: check.error }, 400);
    }

    await db
      .prepare(`
        UPDATE automation_rules
        SET name = ?, channel_type = ?, trigger_type = ?, trigger_config_json = ?,
            response_type = ?, response_content_json = ?, priority = ?, is_active = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND tenant_id = ?
      `)
      .bind(
        check.normalized.name, check.normalized.channel_type, check.normalized.trigger_type,
        check.normalized.trigger_config_json, check.normalized.response_type,
        check.normalized.response_content_json, check.normalized.priority,
        check.normalized.is_active, ruleId, tenant.id
      )
      .run();

    const updated = await db.prepare('SELECT * FROM automation_rules WHERE id = ?').bind(ruleId).first<any>();
    return c.json({ ok: true, rule: updated });
  });

  router.delete('/rules/:id', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const ruleId = c.req.param('id');
    await db
      .prepare('DELETE FROM automation_rules WHERE id = ? AND tenant_id = ?')
      .bind(ruleId, tenant.id)
      .run();

    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // Accounts (channel_connections)
  // ------------------------------------------------------------------
  router.get('/accounts', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const result = await db
      .prepare(`SELECT id, channel_type, account_id, name, token_preview, status, created_at
                FROM channel_connections WHERE tenant_id = ? ORDER BY created_at ASC`)
      .bind(tenant.id)
      .all<any>();

    return c.json({ ok: true, accounts: result.results || [] });
  });

  router.post('/accounts', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!isValidEncryptionKey(encryptionKey)) {
      return c.json({ error: 'Server misconfiguration: ENCRYPTION_KEY missing or invalid' }, 500);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const channelType = body.channel_type;
    if (!VALID_CHANNELS.includes(channelType)) {
      return c.json({ error: `channel_type must be one of: ${VALID_CHANNELS.join(', ')}` }, 400);
    }
    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
    if (accountId.length < 1 || accountId.length > 64) {
      return c.json({ error: 'account_id must be 1-64 characters' }, 400);
    }
    const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
    if (accessToken.length < 10) {
      return c.json({ error: 'access_token must be at least 10 characters' }, 400);
    }
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim().slice(0, 100) : `${channelType} account`;

    const encryptedToken = await encryptAesGcm(accessToken, encryptionKey as string);
    const tokenPreview = `...${accessToken.slice(-4)}`;
    const id = `conn_${crypto.randomUUID()}`;

    try {
      await db
        .prepare(`
          INSERT INTO channel_connections (
            id, tenant_id, channel_type, account_id, name,
            encrypted_access_token, token_preview, webhook_verify_token, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'managed_via_env', 'active')
        `)
        .bind(id, tenant.id, channelType, accountId, name, encryptedToken, tokenPreview)
        .run();
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('UNIQUE')) {
        return c.json({ error: 'An account with this channel_type and account_id already exists' }, 409);
      }
      return c.json({ error: `Failed to create account: ${errStr}` }, 500);
    }

    return c.json({ ok: true, account: { id, channel_type: channelType, account_id: accountId, name, token_preview: tokenPreview, status: 'active' } }, 201);
  });

  router.delete('/accounts/:id', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const accountId = c.req.param('id');
    await db
      .prepare('DELETE FROM channel_connections WHERE id = ? AND tenant_id = ?')
      .bind(accountId, tenant.id)
      .run();

    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // Conversations (inbox)
  // ------------------------------------------------------------------
  router.get('/conversations', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const channelFilter = c.req.query('channel');
    if (channelFilter && !VALID_CHANNELS.includes(channelFilter)) {
      return c.json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }, 400);
    }

    const result = await db
      .prepare(`
        SELECT
          conv.id, conv.handover_state, conv.last_message_preview, conv.unread_count,
          conv.last_customer_message_at, conv.updated_at,
          cc.channel_type, cc.name AS account_name,
          ct.display_name, ct.phone_number_masked
        FROM conversations conv
        JOIN channel_connections cc ON cc.id = conv.channel_connection_id
        LEFT JOIN contacts ct ON ct.id = conv.contact_id
        WHERE conv.tenant_id = ? ${channelFilter ? 'AND cc.channel_type = ?' : ''}
        ORDER BY conv.updated_at DESC
        LIMIT 100
      `)
      .bind(...(channelFilter ? [tenant.id, channelFilter] : [tenant.id]))
      .all<any>();

    return c.json({ ok: true, conversations: result.results || [] });
  });

  router.get('/conversations/:id/messages', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const conversationId = c.req.param('id');
    const conversation = await db
      .prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?')
      .bind(conversationId, tenant.id)
      .first<{ id: string }>();
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

    const result = await db
      .prepare(`SELECT id, direction, sender_type, message_type, body, delivery_status,
                is_simulated, error_message, created_at
                FROM messages WHERE conversation_id = ? AND tenant_id = ?
                ORDER BY created_at ASC LIMIT 200`)
      .bind(conversationId, tenant.id)
      .all<any>();

    return c.json({ ok: true, messages: result.results || [] });
  });

  router.post('/conversations/:id/handover', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const conversationId = c.req.param('id');
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    if (!VALID_HANDOVER_STATES.includes(body?.state)) {
      return c.json({ error: `state must be one of: ${VALID_HANDOVER_STATES.join(', ')}` }, 400);
    }

    const conversation = await db
      .prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?')
      .bind(conversationId, tenant.id)
      .first<{ id: string }>();
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

    await db
      .prepare(`
        UPDATE conversations
        SET handover_state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND tenant_id = ?
      `)
      .bind(body.state, conversationId, tenant.id)
      .run();

    return c.json({ ok: true, state: body.state });
  });

  // ------------------------------------------------------------------
  // POST /conversations/:id/read — mark conversation as read (unread = 0)
  // ------------------------------------------------------------------
  router.post('/conversations/:id/read', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const conversationId = c.req.param('id');
    const conversation = await db
      .prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?')
      .bind(conversationId, tenant.id)
      .first<{ id: string }>();
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404);

    await db
      .prepare('UPDATE conversations SET unread_count = 0, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ? AND tenant_id = ?')
      .bind(conversationId, tenant.id)
      .run();

    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // POST /conversations/:id/reply — send a staff (human_agent) reply
  // Channel-aware dispatch: WhatsApp / Instagram / Messenger adapters.
  // Respects dry_run: simulated replies never contact real recipients.
  // ------------------------------------------------------------------
  router.post('/conversations/:id/reply', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const conversationId = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > 4096) {
      return c.json({ error: 'text must be 1-4096 characters' }, 400);
    }

    const conversation = await db
      .prepare(`
        SELECT id, channel_connection_id, contact_id, handover_state, status
        FROM conversations WHERE id = ? AND tenant_id = ?
      `)
      .bind(conversationId, tenant.id)
      .first<{
        id: string;
        channel_connection_id: string;
        contact_id: string;
        handover_state: string;
        status: string;
      }>();
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404);
    if (conversation.status === 'archived' || conversation.status === 'closed') {
      return c.json({ error: 'This conversation is closed or archived. Reopen it before replying.' }, 409);
    }

    const connection = await db
      .prepare(`
        SELECT id, tenant_id, channel_type, account_id, encrypted_access_token, status
        FROM channel_connections WHERE id = ? AND tenant_id = ?
      `)
      .bind(conversation.channel_connection_id, tenant.id)
      .first<{
        id: string;
        tenant_id: string;
        channel_type: 'whatsapp' | 'instagram' | 'messenger';
        account_id: string;
        encrypted_access_token: string;
        status: string;
      }>();
    if (!connection) return c.json({ error: 'Channel account not found for this conversation' }, 404);
    if (connection.status !== 'active') {
      return c.json({ error: 'This channel account is not active. Reconnect it in Channels first.' }, 409);
    }

    const contact = await db
      .prepare('SELECT id, encrypted_platform_sender_id FROM contacts WHERE id = ? AND tenant_id = ?')
      .bind(conversation.contact_id, tenant.id)
      .first<{ id: string; encrypted_platform_sender_id: string }>();
    if (!contact) return c.json({ error: 'Contact not found' }, 404);

    const settings = await db
      .prepare('SELECT dry_run FROM tenant_settings WHERE tenant_id = ?')
      .bind(tenant.id)
      .first<{ dry_run: number }>();
    const isDryRun = settings ? settings.dry_run === 1 : true;

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!isValidEncryptionKey(encryptionKey)) {
      return c.json({ error: 'Server misconfiguration: ENCRYPTION_KEY missing or invalid' }, 500);
    }

    const messageId = `msg_out_${crypto.randomUUID()}`;

    // Conversation hygiene: staff reply implies human takeover of human_requested threads
    const nextState = conversation.handover_state === 'human_requested' ? 'human_assigned' : conversation.handover_state;

    if (isDryRun) {
      // Simulated staff reply: never contacts real recipients (safe in Test mode)
      await db
        .prepare(`
          INSERT INTO messages (
            id, tenant_id, conversation_id, channel_connection_id,
            direction, sender_type, message_type, provider_message_id,
            body, delivery_status, is_simulated
          ) VALUES (?, ?, ?, ?, 'outbound', 'human_agent', 'text', NULL, ?, 'simulated', 1)
        `)
        .bind(messageId, tenant.id, conversation.id, connection.id, `[SIMULATED STAFF REPLY] ${text}`)
        .run();

      await db
        .prepare(`
          UPDATE conversations
          SET handover_state = ?, last_message_preview = ?, unread_count = 0,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND tenant_id = ?
        `)
        .bind(nextState, text.slice(0, 100), conversation.id, tenant.id)
        .run();

      const created = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first<any>();
      return c.json({ ok: true, simulated: true, message: created });
    }

    // Real dispatch path
    let accessToken: string;
    let recipientId: string;
    try {
      accessToken = await decryptAesGcm(connection.encrypted_access_token, encryptionKey as string);
      recipientId = await decryptAesGcm(contact.encrypted_platform_sender_id, encryptionKey as string);
    } catch {
      return c.json({ error: 'Failed to decrypt stored credentials. Reconnect the channel account.' }, 500);
    }

    let sendResult: { success: boolean; messageId?: string; errorCode?: number; errorMessage?: string };
    if (connection.channel_type === 'whatsapp') {
      sendResult = await sendWhatsAppTextMessage({
        graphApiVersion: c.env.GRAPH_API_VERSION,
        phoneNumberId: connection.account_id,
        accessToken,
        toWaId: recipientId,
        text
      });
    } else if (connection.channel_type === 'instagram') {
      sendResult = await sendInstagramTextMessage({
        graphApiVersion: c.env.GRAPH_API_VERSION,
        instagramAccountId: connection.account_id,
        accessToken,
        toIgsid: recipientId,
        text
      });
    } else {
      sendResult = await sendMessengerTextMessage({
        graphApiVersion: c.env.GRAPH_API_VERSION,
        pageId: connection.account_id,
        accessToken,
        toPsid: recipientId,
        text
      });
    }

    await db
      .prepare(`
        INSERT INTO messages (
          id, tenant_id, conversation_id, channel_connection_id,
          direction, sender_type, message_type, provider_message_id,
          body, delivery_status, error_message, is_simulated
        ) VALUES (?, ?, ?, ?, 'outbound', 'human_agent', 'text', ?, ?, ?, ?, 0)
      `)
      .bind(
        messageId,
        tenant.id,
        conversation.id,
        connection.id,
        sendResult.success && sendResult.messageId ? sendResult.messageId : null,
        text,
        sendResult.success ? 'sent' : 'failed',
        sendResult.success ? null : (sendResult.errorMessage || 'Dispatch failed')
      )
      .run();

    await db
      .prepare(`
        UPDATE conversations
        SET handover_state = ?, last_message_preview = ?, unread_count = 0,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND tenant_id = ?
      `)
      .bind(nextState, text.slice(0, 100), conversation.id, tenant.id)
      .run();

    const created = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first<any>();
    return c.json({ ok: true, simulated: false, message: created });
  });

  // ------------------------------------------------------------------
  // PUT /accounts/:id — update a channel connection
  // (rename, update access token, connect/disconnect)
  // ------------------------------------------------------------------
  router.put('/accounts/:id', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const accountId = c.req.param('id');
    const existing = await db
      .prepare('SELECT id, token_preview FROM channel_connections WHERE id = ? AND tenant_id = ?')
      .bind(accountId, tenant.id)
      .first<{ id: string }>();
    if (!existing) return c.json({ error: 'Account not found' }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const VALID_STATUSES = ['active', 'disconnected', 'expired'];
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 1 || name.length > 100) {
        return c.json({ error: 'name must be 1-100 characters' }, 400);
      }
    }
    if (body.access_token !== undefined) {
      const token = typeof body.access_token === 'string' ? body.access_token.trim() : '';
      if (token.length < 10) {
        return c.json({ error: 'access_token must be at least 10 characters' }, 400);
      }
    }

    // Build dynamic update
    const sets: string[] = [];
    const binds: any[] = [];

    if (body.name !== undefined) {
      sets.push('name = ?');
      binds.push(body.name.trim().slice(0, 100));
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      binds.push(body.status);
    }
    if (body.access_token !== undefined) {
      const encryptionKey = c.env.ENCRYPTION_KEY;
      if (!isValidEncryptionKey(encryptionKey)) {
        return c.json({ error: 'Server misconfiguration: ENCRYPTION_KEY missing or invalid' }, 500);
      }
      const token = (body.access_token as string).trim();
      sets.push('encrypted_access_token = ?', 'token_preview = ?');
      binds.push(await encryptAesGcm(token, encryptionKey as string));
      binds.push(`...${token.slice(-4)}`);
    }

    if (sets.length === 0) {
      return c.json({ error: 'Nothing to update. Provide name, status, and/or access_token.' }, 400);
    }

    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    binds.push(accountId, tenant.id);

    await db
      .prepare(`UPDATE channel_connections SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...binds)
      .run();

    const updated = await db
      .prepare(`SELECT id, channel_type, account_id, name, token_preview, status, created_at
                FROM channel_connections WHERE id = ? AND tenant_id = ?`)
      .bind(accountId, tenant.id)
      .first<any>();

    return c.json({ ok: true, account: updated });
  });

  // ------------------------------------------------------------------
  // GET /webhook-info — callback URLs + verify-token presence for Meta setup
  // Never returns the verify token value itself, only whether it is configured.
  // ------------------------------------------------------------------
  router.get('/webhook-info', (c) => {
    let origin = '';
    try {
      origin = new URL(c.req.url).origin;
    } catch {
      origin = '';
    }

    return c.json({
      ok: true,
      baseUrl: origin,
      verifyTokenConfigured: !!c.env.META_WEBHOOK_VERIFY_TOKEN,
      appSecretConfigured: !!c.env.META_APP_SECRET,
      webhooks: {
        whatsapp: `${origin}/api/v1/webhooks/whatsapp`,
        instagram: `${origin}/api/v1/webhooks/instagram`,
        messenger: `${origin}/api/v1/webhooks/facebook`
      }
    });
  });

  // ------------------------------------------------------------------
  // GET /contacts — customer directory (masked PII only)
  // ------------------------------------------------------------------
  router.get('/contacts', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const result = await db
      .prepare(`
        SELECT
          ct.id, ct.channel_type, ct.display_name, ct.phone_number_masked,
          ct.created_at,
          COUNT(DISTINCT conv.id) AS conversation_count,
          MAX(m.created_at) AS last_message_at
        FROM contacts ct
        LEFT JOIN conversations conv ON conv.contact_id = ct.id AND conv.tenant_id = ct.tenant_id
        LEFT JOIN messages m ON m.conversation_id = conv.id AND m.tenant_id = ct.tenant_id
        WHERE ct.tenant_id = ?
        GROUP BY ct.id
        ORDER BY ct.created_at DESC
        LIMIT 200
      `)
      .bind(tenant.id)
      .all<any>();

    return c.json({ ok: true, contacts: result.results || [] });
  });

  // ------------------------------------------------------------------
  // GET /stats/daily — last 7 days inbound/outbound message counts
  // ------------------------------------------------------------------
  router.get('/stats/daily', async (c) => {
    const db = c.env.DB;
    const tenant = await getPrimaryTenant(db);
    if (!tenant) return c.json({ error: 'No tenant found.' }, 404);

    const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00.000Z';

    const result = await db
      .prepare(`
        SELECT strftime('%Y-%m-%d', created_at) AS day,
          SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
          SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound
        FROM messages
        WHERE tenant_id = ? AND created_at >= ?
        GROUP BY day
        ORDER BY day ASC
      `)
      .bind(tenant.id, since)
      .all<{ day: string; inbound: number; outbound: number }>();

    // Fill missing days with zeros so the chart always spans exactly 7 days
    const byDay = new Map<string, { day: string; inbound: number; outbound: number }>();
    for (const row of result.results || []) {
      byDay.set(row.day, { day: row.day, inbound: Number(row.inbound) || 0, outbound: Number(row.outbound) || 0 });
    }
    const series: Array<{ day: string; inbound: number; outbound: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      series.push(byDay.get(d) || { day: d, inbound: 0, outbound: 0 });
    }

    return c.json({ ok: true, series });
  });

  return router;
}
