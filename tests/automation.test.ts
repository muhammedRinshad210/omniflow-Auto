import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import {
  evaluateAutomation,
  isWithinBusinessHours,
  isHandoverExpired,
  hasAlreadyReplied,
  checkRuleMatch,
  resolveBilingualResponse,
  type AutomationRuleRow
} from '../apps/api/src/services/automation.ts';

function createD1Mock(db: DatabaseSync): D1Database {
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

describe('Phase 2 Automation Engine Tests', () => {
  let db: DatabaseSync;
  let d1: D1Database;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const m1 = readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8');
    const m2 = readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8');
    const m3 = readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8');
    db.exec(m1);
    db.exec(m2);
    db.exec(m3);
    d1 = createD1Mock(db);

    // Setup Tenant A
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_auto_a', 'Tenant Auto A', 'auto-a')").run();
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language, handover_timeout_minutes, business_hours_json)
      VALUES ('ten_auto_a', 'live', 1, '[]', 'ml', 30, '{"startHour":9,"endHour":18,"timezone":"Asia/Kolkata"}')
    `).run();

    db.prepare(`
      INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token)
      VALUES ('conn_a', 'ten_auto_a', 'whatsapp', '12345', 'WA', 'v1:a:b', 'EAA...', 'token')
    `).run();

    db.prepare(`
      INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash)
      VALUES ('cnt_a', 'ten_auto_a', 'whatsapp', 'v1:c:d', 'hash_a')
    `).run();

    db.prepare(`
      INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id, handover_state)
      VALUES ('conv_a', 'ten_auto_a', 'conn_a', 'cnt_a', 'bot')
    `).run();
  });

  // --------------------------------------------------------------------------
  // 1. CORRECTION 2: Keyword Format Backward Compatibility & Match Types
  // --------------------------------------------------------------------------
  describe('Rule Parser & Keyword Match Types (Backward & New Formats)', () => {
    test('Legacy format: keyword_exact with plain string array', () => {
      const rule: AutomationRuleRow = {
        id: 'r_legacy_exact',
        tenant_id: 'ten_auto_a',
        name: 'Legacy Exact',
        channel_type: 'whatsapp',
        trigger_type: 'keyword_exact',
        trigger_config_json: JSON.stringify(['fees', 'ഫീസ്']),
        response_type: 'text',
        response_content_json: '{"en":"Fees is 100","ml":"ഫീസ് 100"}',
        priority: 10,
        is_active: 1
      };

      assert.equal(checkRuleMatch(rule, 'fees'), true);
      assert.equal(checkRuleMatch(rule, 'FEES'), true); // Latin case-insensitive
      assert.equal(checkRuleMatch(rule, 'fees please'), false); // Exact match rejects substring
      assert.equal(checkRuleMatch(rule, 'ഫീസ്'), true); // Malayalam exact match
      assert.equal(checkRuleMatch(rule, 'ഫീസ് എത്രയാണ്'), false);
    });

    test('Legacy format: keyword_contains with plain string array', () => {
      const rule: AutomationRuleRow = {
        id: 'r_legacy_contains',
        tenant_id: 'ten_auto_a',
        name: 'Legacy Contains',
        channel_type: 'whatsapp',
        trigger_type: 'keyword_contains',
        trigger_config_json: JSON.stringify(['brochure', 'വില വിവരങ്ങൾ']),
        response_type: 'text',
        response_content_json: '{"en":"Here is brochure","ml":"വിവരങ്ങൾ ഇതാ"}',
        priority: 10,
        is_active: 1
      };

      assert.equal(checkRuleMatch(rule, 'Please send the Brochure pdf'), true);
      assert.equal(checkRuleMatch(rule, 'ഹലോ, വില വിവരങ്ങൾ അറിയണം'), true);
      assert.equal(checkRuleMatch(rule, 'hello there'), false);
    });

    test('New format: keyword trigger with object config and starts_with', () => {
      const rule: AutomationRuleRow = {
        id: 'r_new_starts_with',
        tenant_id: 'ten_auto_a',
        name: 'New Starts With',
        channel_type: 'whatsapp',
        trigger_type: 'keyword',
        trigger_config_json: JSON.stringify({
          keywords: ['book appointment', 'ബുക്കിംഗ്'],
          match: 'starts_with'
        }),
        response_type: 'text',
        response_content_json: '{"en":"Booking details","ml":"ബുക്കിംഗ് വിവരങ്ങൾ"}',
        priority: 10,
        is_active: 1
      };

      assert.equal(checkRuleMatch(rule, 'Book Appointment for tomorrow'), true);
      assert.equal(checkRuleMatch(rule, 'Can I book appointment?'), false); // Doesn't start with keyword
      assert.equal(checkRuleMatch(rule, 'ബുക്കിംഗ് നാളെ വേണം'), true);
      assert.equal(checkRuleMatch(rule, 'നാളെ ബുക്കിംഗ് വേണം'), false);
    });

    test('New format: keyword trigger with object config and exact match', () => {
      const rule: AutomationRuleRow = {
        id: 'r_new_exact',
        tenant_id: 'ten_auto_a',
        name: 'New Exact',
        channel_type: 'whatsapp',
        trigger_type: 'keyword',
        trigger_config_json: JSON.stringify({
          keywords: ['help', 'സഹായം'],
          match: 'exact'
        }),
        response_type: 'text',
        response_content_json: '{"en":"Help text","ml":"സഹായം"}',
        priority: 10,
        is_active: 1
      };

      assert.equal(checkRuleMatch(rule, 'HELP'), true);
      assert.equal(checkRuleMatch(rule, 'help me'), false);
      assert.equal(checkRuleMatch(rule, 'സഹായം'), true);
      assert.equal(checkRuleMatch(rule, 'സഹായം വേണം'), false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Rule Priority Resolution & Stable Tie-break
  // --------------------------------------------------------------------------
  describe('Rule Priority & Inactive Filtering', () => {
    test('Higher priority rule wins over lower priority rule', async () => {
      // Priority 10 rule: matches "rate"
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active, created_at)
        VALUES ('rule_low', 'ten_auto_a', 'Low Priority Rate', 'whatsapp', 'keyword_contains', '["rate"]', 'text', '{"en":"Low priority rate response"}', 10, 1, '2026-11-19T01:00:00Z')
      `).run();

      // Priority 50 rule: also matches "rate"
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active, created_at)
        VALUES ('rule_high', 'ten_auto_a', 'High Priority Rate', 'whatsapp', 'keyword_contains', '["rate"]', 'text', '{"en":"High priority rate response"}', 50, 1, '2026-11-19T02:00:00Z')
      `).run();

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_in_pri_1',
        normalizedFrom: '919876543210',
        bodyText: 'What is the rate?',
        messageDate: new Date('2026-11-19T10:00:00Z')
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.ruleId, 'rule_high');
      assert.equal(decision.replyText, 'High priority rate response');
    });

    test('Inactive rules (is_active = 0) are skipped', async () => {
      // Inactive high priority rule
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_inactive', 'ten_auto_a', 'Inactive Rule', 'whatsapp', 'keyword_contains', '["promo"]', 'text', '{"en":"Promo code 50"}', 100, 0)
      `).run();

      // Active fallback rule
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_fallback', 'ten_auto_a', 'Fallback', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"General fallback response"}', 0, 1)
      `).run();

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_in_promo',
        normalizedFrom: '919876543210',
        bodyText: 'Can I get a promo?',
        messageDate: new Date('2026-11-19T10:00:00Z')
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.ruleId, 'rule_fallback'); // Inactive promo skipped, fallback evaluated
    });

    test('Default fallback matches only when NO keyword rule matches', async () => {
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_greeting', 'ten_auto_a', 'Greeting', 'whatsapp', 'keyword_exact', '["hello"]', 'text', '{"en":"Hello customer!"}', 20, 1),
               ('rule_fb', 'ten_auto_a', 'Fallback', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"Fallback answer"}', 0, 1)
      `).run();

      // Case 1: Keyword matches
      const matchDecision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_in_kw',
        normalizedFrom: '919876543210',
        bodyText: 'hello',
        messageDate: new Date('2026-11-19T10:00:00Z')
      });
      assert.equal(matchDecision.ruleId, 'rule_greeting');

      // Case 2: No keyword matches
      const fbDecision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_in_none',
        normalizedFrom: '919876543210',
        bodyText: 'what are your doctor qualifications?',
        messageDate: new Date('2026-11-19T10:00:00Z')
      });
      assert.equal(fbDecision.ruleId, 'rule_fb');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Bilingual Response Resolution
  // --------------------------------------------------------------------------
  describe('Bilingual Response Resolution', () => {
    const jsonContent = JSON.stringify({
      en: 'English response text',
      ml: 'മലയാളം മറുപടി'
    });

    test('Malayalam script inbound resolves Malayalam response', () => {
      const res = resolveBilingualResponse(jsonContent, 'ഹലോ ഡോക്ടർ ഉണ്ടോ?');
      assert.equal(res, 'മലയാളം മറുപടി');
    });

    test('Latin script inbound resolves English response', () => {
      const res = resolveBilingualResponse(jsonContent, 'Hello, is doctor available?');
      assert.equal(res, 'English response text');
    });

    test('Missing Malayalam key falls back to English', () => {
      const englishOnlyJson = JSON.stringify({ en: 'Only English Available' });
      const res = resolveBilingualResponse(englishOnlyJson, 'ഹലോ സുഖമാണോ?');
      assert.equal(res, 'Only English Available');
    });

    test('Missing English key falls back to first available non-empty key', () => {
      const mlOnlyJson = JSON.stringify({ ml: 'മലയാളം മാത്രം' });
      const res = resolveBilingualResponse(mlOnlyJson, 'Is doctor there?');
      assert.equal(res, 'മലയാളം മാത്രം');
    });
  });

  // --------------------------------------------------------------------------
  // 4. CORRECTION 1: Human Handover & Timeout Auto-Resume (sender_type = 'human_agent')
  // --------------------------------------------------------------------------
  describe('Human Handover Expiry with sender_type = human_agent', () => {
    test('Handover active within timeout stays silent', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      // Insert message with real schema sender_type = 'human_agent' per Correction 1
      db.prepare(`
        INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, body, created_at)
        VALUES ('msg_agent_recent', 'ten_auto_a', 'conv_a', 'conn_a', 'outbound', 'human_agent', 'text', 'I am here to help you.', ?)
      `).run(tenMinutesAgo);

      // Verify the row exists with human_agent
      const row = db.prepare("SELECT sender_type FROM messages WHERE id = 'msg_agent_recent'").get() as any;
      assert.equal(row.sender_type, 'human_agent');

      // Handover is active on conversation
      const conversation = { id: 'conv_a', handover_state: 'human_requested' };

      const isExpired = await isHandoverExpired(d1, 'ten_auto_a', 'conv_a', 30);
      assert.equal(isExpired, false, '10 minutes elapsed is within 30-minute timeout: must not be expired');

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation,
        settings: { automation_mode: 'live', handover_timeout_minutes: 30 },
        inboundMsgId: 'msg_in_handover_1',
        normalizedFrom: '919876543210',
        bodyText: 'hello again'
      });

      assert.equal(decision.shouldReply, false);
      assert.match(decision.reason || '', /Human handover active/);
    });

    test('Handover active past timeout automatically resumes automation', async () => {
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();

      // Insert human_agent message from 40 minutes ago
      db.prepare(`
        INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, body, created_at)
        VALUES ('msg_agent_old', 'ten_auto_a', 'conv_a', 'conn_a', 'outbound', 'human_agent', 'text', 'Staff will follow up.', ?)
      `).run(fortyMinutesAgo);

      // Add a fallback rule so we can verify reply is produced
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_resume', 'ten_auto_a', 'Auto Resume Rule', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"Automation resumed after agent idle"}', 1, 1)
      `).run();

      const conversation = { id: 'conv_a', handover_state: 'human_requested' };

      const isExpired = await isHandoverExpired(d1, 'ten_auto_a', 'conv_a', 30);
      assert.equal(isExpired, true, '40 minutes elapsed exceeds 30-minute timeout: must be expired');

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation,
        settings: { automation_mode: 'live', handover_timeout_minutes: 30 },
        inboundMsgId: 'msg_in_resume',
        normalizedFrom: '919876543210',
        bodyText: 'Are you still there?',
        messageDate: new Date()
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.replyText, 'Automation resumed after agent idle');
    });

    test('Handover with null timeout stays paused indefinitely', async () => {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, body, created_at)
        VALUES ('msg_agent_null_timeout', 'ten_auto_a', 'conv_a', 'conn_a', 'outbound', 'human_agent', 'text', 'Hello', ?)
      `).run(twoHoursAgo);

      const isExpired = await isHandoverExpired(d1, 'ten_auto_a', 'conv_a', null);
      assert.equal(isExpired, false, 'Null timeout must never expire automatically');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Away Hours (Business Hours)
  // --------------------------------------------------------------------------
  describe('Business Hours & Away Mode', () => {
    const businessHoursJson = JSON.stringify({
      startHour: 9,
      endHour: 18,
      timezone: 'Asia/Kolkata'
    });

    test('Inside business hours: keyword rules fire normally', async () => {
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_hours_kw', 'ten_auto_a', 'Keyword Rule', 'whatsapp', 'keyword_contains', '["hours"]', 'text', '{"en":"Open 9 to 6"}', 10, 1),
               ('rule_hours_fb', 'ten_auto_a', 'Fallback Rule', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"We are closed now"}', 0, 1)
      `).run();

      // 14:30 IST is 09:00 UTC
      const afternoonTime = new Date('2026-11-19T09:00:00Z');
      assert.equal(isWithinBusinessHours(businessHoursJson, afternoonTime), true);

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live', business_hours_json: businessHoursJson },
        inboundMsgId: 'msg_in_hours_inside',
        normalizedFrom: '919876543210',
        bodyText: 'What are your hours?',
        messageDate: afternoonTime
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.ruleId, 'rule_hours_kw');
      assert.equal(decision.replyText, 'Open 9 to 6');
    });

    test('Outside business hours: keyword rules are silent, fallback rule fires', async () => {
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_hours_kw2', 'ten_auto_a', 'Keyword Rule', 'whatsapp', 'keyword_contains', '["doctor"]', 'text', '{"en":"Doctor is in"}', 10, 1),
               ('rule_hours_fb2', 'ten_auto_a', 'Fallback Rule', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"We are currently closed. We will respond tomorrow."}', 0, 1)
      `).run();

      // 22:30 IST is 17:00 UTC (outside 9-18)
      const nightTime = new Date('2026-11-19T17:00:00Z');
      assert.equal(isWithinBusinessHours(businessHoursJson, nightTime), false);

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live', business_hours_json: businessHoursJson },
        inboundMsgId: 'msg_in_hours_outside',
        normalizedFrom: '919876543210',
        bodyText: 'Is doctor available now?',
        messageDate: nightTime
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.ruleId, 'rule_hours_fb2'); // Keyword rule skipped; fallback fires
      assert.equal(decision.replyText, 'We are currently closed. We will respond tomorrow.');
    });

    test('Null business hours setting = always on (keywords fire anytime)', async () => {
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_always_on', 'ten_auto_a', 'Always On', 'whatsapp', 'keyword_contains', '["urgent"]', 'text', '{"en":"Urgent response"}', 10, 1)
      `).run();

      const midnightTime = new Date('2026-11-19T23:30:00Z');
      assert.equal(isWithinBusinessHours(null, midnightTime), true);

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live', business_hours_json: null },
        inboundMsgId: 'msg_in_midnight',
        normalizedFrom: '919876543210',
        bodyText: 'This is urgent',
        messageDate: midnightTime
      });

      assert.equal(decision.shouldReply, true);
      assert.equal(decision.ruleId, 'rule_always_on');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Deduplication & Safety Guards
  // --------------------------------------------------------------------------
  describe('Deduplication & Safety Guards', () => {
    test('Inbound message already replied is not replied again', async () => {
      const inboundId = 'msg_target_dedupe';

      // Insert outbound message already referencing inboundId
      db.prepare(`
        INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, body, in_reply_to_message_id)
        VALUES ('msg_out_existing', 'ten_auto_a', 'conv_a', 'conn_a', 'outbound', 'bot', 'text', 'Prior reply', ?)
      `).run(inboundId);

      assert.equal(await hasAlreadyReplied(d1, 'ten_auto_a', inboundId), true);

      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_dedupe_test', 'ten_auto_a', 'Rule', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"Should not send"}', 1, 1)
      `).run();

      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: inboundId,
        normalizedFrom: '919876543210',
        bodyText: 'Hello again',
        messageDate: new Date()
      });

      assert.equal(decision.shouldReply, false);
      assert.match(decision.reason || '', /already replied/);
    });

    test('Tenant with no active rules does not reply', async () => {
      // No rules inserted in DB for ten_auto_a
      const decision = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_a',
        conversation: { id: 'conv_a', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_no_rules',
        normalizedFrom: '919876543210',
        bodyText: 'Testing without rules',
        messageDate: new Date()
      });

      assert.equal(decision.shouldReply, false);
      assert.match(decision.reason || '', /No active automation rules/);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Tenant Isolation (R7)
  // --------------------------------------------------------------------------
  describe('Multi-Tenant Isolation in Automation Engine (R7)', () => {
    test('Tenant B messages cannot trigger Tenant A rules', async () => {
      // Create Tenant B
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_auto_b', 'Tenant Auto B', 'auto-b')").run();
      db.prepare(`
        INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
        VALUES ('ten_auto_b', 'live', 1, '[]', 'en')
      `).run();

      // Rule only belongs to Tenant A
      db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active)
        VALUES ('rule_tenant_a_secret', 'ten_auto_a', 'Tenant A Exclusive Rule', 'whatsapp', 'keyword_contains', '["special"]', 'text', '{"en":"Secret Tenant A Info"}', 10, 1)
      `).run();

      const decisionTenantB = await evaluateAutomation({
        db: d1,
        tenantId: 'ten_auto_b',
        conversation: { id: 'conv_b', handover_state: 'bot' },
        settings: { automation_mode: 'live' },
        inboundMsgId: 'msg_in_tenant_b',
        normalizedFrom: '919876543210',
        bodyText: 'Give me the special info',
        messageDate: new Date()
      });

      assert.equal(decisionTenantB.shouldReply, false);
      assert.match(decisionTenantB.reason || '', /No active automation rules for tenant/);
    });
  });
});
