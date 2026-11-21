import { Hono } from 'hono';
import {
  verifyMetaHmac,
  timingSafeStringEqual,
  encryptAesGcm,
  computeKeyedLookupHash,
  decryptAesGcm
} from '../../services/crypto.ts';
import { evaluateAutomation } from '../../services/automation.ts';
import { sendMessengerTextMessage } from '../../adapters/facebook/client.ts';
import { sendInstagramTextMessage } from '../../adapters/instagram/client.ts';
import type { Env } from '../../types/env.ts';

export type MessagingChannelType = 'facebook' | 'instagram';

function isValidEncryptionKey(key?: string): boolean {
  if (!key || typeof key !== 'string') return false;
  try {
    const raw = Uint8Array.from(atob(key.trim()), (c) => c.charCodeAt(0));
    return raw.byteLength === 32;
  } catch {
    return false;
  }
}

function isValidLookupHashSecret(secret?: string): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const trimmed = secret.trim();
  return trimmed.length >= 32 && trimmed.length % 2 === 0 && /^[0-9a-f]+$/i.test(trimmed);
}

/**
 * Masks platform-scoped IDs (PSID / IGSID) for safe display/storage.
 * Long IDs keep the first 2 and last 2 characters; short IDs are fully masked.
 */
function maskPlatformId(raw: string): string {
  if (!raw || raw.length < 8) return '****';
  return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
}

interface ParsedMessagingEvent {
  accountId: string;
  dedupeKey: string;
  senderId: string;
  bodyText: string;
  isEcho: boolean;
}

/**
 * Shared ingestion + processing pipeline for Facebook Messenger and Instagram
 * Messaging webhooks. Both channels use the Meta Graph API webhook format:
 *   { object: 'page' | 'instagram', entry: [ { id, messaging: [ ... ] } ] }
 *
 * Verified behaviors carried over from the WhatsApp pipeline (Phase 1.1):
 * - HMAC-SHA256 verified BEFORE JSON parsing
 * - Fail-closed cryptographic secret guards (Bug 4)
 * - PII masking on raw_payload_preview, no run of 6+ digits (Bug 5)
 * - Unregistered account IDs are skipped, never 500 (Bug 2)
 * - Duplicate dedupe_keys are skipped inside the loop, never mid-batch
 *   return 200 (Bug 1)
 * - UNIQUE in_reply_to_message_id violations are skip+log (M1)
 */
export function createMessagingWebhookRouter(channelType: MessagingChannelType) {
  const routeName = channelType === 'facebook' ? 'facebook' : 'instagram';
  // Canonical DB channel_type (schema enum: 'whatsapp' | 'instagram' | 'messenger')
  const dbChannelType = channelType === 'facebook' ? 'messenger' : channelType;

  const router = new Hono<{ Bindings: Env }>();

  // ------------------------------------------------------------------
  // GET: Meta Webhook Challenge Verification Handshake
  // ------------------------------------------------------------------
  router.get(`/${routeName}`, (c) => {
    const query = c.req.query();
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const expectedToken = c.env.META_WEBHOOK_VERIFY_TOKEN;

    if (
      mode === 'subscribe' &&
      token &&
      expectedToken &&
      timingSafeStringEqual(token, expectedToken)
    ) {
      return c.text(challenge || '', 200);
    }

    return c.text('Forbidden: Invalid verify token or mode', 403);
  });

  // ------------------------------------------------------------------
  // POST: Secure Webhook Ingestion & Background Dispatch
  // ------------------------------------------------------------------
  router.post(`/${routeName}`, async (c) => {
    const db = c.env.DB;
    const appSecret = c.env.META_APP_SECRET;

    if (!appSecret) {
      console.error(`[${routeName} Webhook] META_APP_SECRET is not configured.`);
      return c.json({ error: 'Server misconfiguration' }, 500);
    }

    // Cryptographic Secrets Guard: fail closed if missing or invalid (Bug 4)
    if (!isValidEncryptionKey(c.env.ENCRYPTION_KEY) || !isValidLookupHashSecret(c.env.LOOKUP_HASH_SECRET)) {
      console.error(`[${routeName} Webhook] Invalid or missing ENCRYPTION_KEY or LOOKUP_HASH_SECRET.`);
      return c.json({ error: 'Server misconfiguration: invalid or missing cryptographic secrets' }, 500);
    }

    // 1. Verify HMAC-SHA256 BEFORE parsing JSON
    const rawBody = await c.req.raw.arrayBuffer();
    const signatureHeader = c.req.header('X-Hub-Signature-256');
    const isValid = await verifyMetaHmac(rawBody, signatureHeader, appSecret);
    if (!isValid) {
      return c.json({ error: 'Invalid HMAC signature' }, 401);
    }

    // 2. Parse JSON safely
    let payload: any;
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return c.json({ error: 'Malformed JSON payload' }, 400);
    }

    // 3. Extract messaging events (tolerant of object naming variations)
    const entries = payload?.entry;
    if (!Array.isArray(entries) || entries.length === 0) {
      return c.text('EVENT_RECEIVED', 200);
    }

    // PII Guard: mask any run of 6+ digits in the raw preview (Bug 5)
    const rawPreview = JSON.stringify(payload)
      .replace(/\d{6,}/g, (d) => d.slice(0, 2) + '****' + d.slice(-2))
      .slice(0, 500);

    const parsedEvents: ParsedMessagingEvent[] = [];

    for (const entry of entries) {
      const accountId = entry?.id ? String(entry.id) : '';
      if (!accountId) continue;

      const messagingItems = entry?.messaging;
      if (!Array.isArray(messagingItems)) continue;

      for (const item of messagingItems) {
        const senderId = item?.sender?.id ? String(item.sender.id) : '';
        const message = item?.message;

        if (!senderId || !message) continue;
        if (message.is_echo === true) continue; // Our own outbound echo
        if (!message.mid) continue;

        let bodyText = '';
        if (typeof message.text === 'string' && message.text.trim().length > 0) {
          bodyText = message.text;
        } else if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          bodyText = `[${String(message.attachments[0]?.type || 'attachment').toUpperCase()} received]`;
        }

        parsedEvents.push({
          accountId,
          dedupeKey: String(message.mid),
          senderId,
          bodyText,
          isEcho: false
        });
      }
    }

    // 4. Durable Ingestion: insert events as 'received' BEFORE returning 200
    const eventsToDispatch: Array<ParsedMessagingEvent & { channelRowId: string }> = [];

    for (const ev of parsedEvents) {
      const channel = await db
        .prepare('SELECT id, tenant_id, status FROM channel_connections WHERE channel_type = ? AND account_id = ?')
        .bind(dbChannelType, ev.accountId)
        .first<{ id: string; tenant_id: string; status: string }>();

      // Unregistered account id: skip event and continue loop (Bug 2 pattern)
      if (!channel) {
        console.warn(`[${routeName} Ingestion] Unregistered account_id: ${ev.accountId}. Safely ignoring.`);
        continue;
      }

      const eventId = `wh_${crypto.randomUUID()}`;
      try {
        await db
          .prepare(`
            INSERT INTO webhook_events (
              id, tenant_id, channel_type, event_type, dedupe_key,
              payload_summary_json, raw_payload_preview, processing_status, retention_expires_at
            ) VALUES (?, ?, ?, 'message', ?, ?, ?, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days'))
          `)
          .bind(
            eventId,
            channel.tenant_id,
            dbChannelType,
            ev.dedupeKey,
            JSON.stringify({ type: 'message', fromMasked: maskPlatformId(ev.senderId) }),
            rawPreview
          )
          .run();
        eventsToDispatch.push({ ...ev, channelRowId: channel.id });
      } catch (err: unknown) {
        const errStr = err instanceof Error ? err.message : String(err);
        if (errStr.includes('UNIQUE constraint failed')) {
          // Exact duplicate: log and CONTINUE loop, never return mid-batch (Bug 1)
          console.info(`[${routeName} Ingestion] Duplicate event received (${ev.dedupeKey}). Safely skipping duplicate.`);
          continue;
        }
        console.error(`[${routeName} Ingestion Error] D1 insert failed:`, errStr);
        return c.text('Internal Server Error', 500);
      }
    }

    // 5. Immediate 200 Acknowledgement & Async Background Dispatch
    let hasWaitUntil = false;
    try {
      const ctx = c.executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        hasWaitUntil = true;
        ctx.waitUntil(processMessagingEvents(c.env, channelType, eventsToDispatch));
      }
    } catch {
      hasWaitUntil = false;
    }

    if (!hasWaitUntil) {
      await processMessagingEvents(c.env, channelType, eventsToDispatch);
    }

    return c.text('EVENT_RECEIVED', 200);
  });

  return router;
}

/**
 * Async background processing for Facebook / Instagram messaging events.
 * Mirrors the verified WhatsApp pipeline (contact/conversation upsert,
 * automation engine evaluation, simulated vs real dispatch).
 */
export async function processMessagingEvents(
  env: Env,
  channelType: MessagingChannelType,
  events: Array<ParsedMessagingEvent & { channelRowId: string }>
): Promise<void> {
  const db = env.DB;
  const dbChannelType2 = channelType === 'facebook' ? 'messenger' : channelType;

  for (const ev of events) {
    try {
      // 1. Resolve channel connection
      const channel = await db
        .prepare(`
          SELECT id, tenant_id, encrypted_access_token, status, account_id
          FROM channel_connections
          WHERE channel_type = ? AND account_id = ?
        `)
        .bind(dbChannelType2, ev.accountId)
        .first<{
          id: string;
          tenant_id: string;
          encrypted_access_token: string;
          status: string;
          account_id: string;
        }>();

      if (!channel || channel.status !== 'active') {
        await db
          .prepare("UPDATE webhook_events SET processing_status = 'ignored', error_details = 'Channel inactive or not found' WHERE dedupe_key = ?")
          .bind(ev.dedupeKey)
          .run();
        continue;
      }

      const tenantId = channel.tenant_id;

      // 2. Resolve tenant settings
      const settings = await db
        .prepare('SELECT automation_mode, dry_run, allowlist_json, default_language, handover_timeout_minutes, business_hours_json FROM tenant_settings WHERE tenant_id = ?')
        .bind(tenantId)
        .first<{
          automation_mode: 'off' | 'test' | 'live';
          dry_run: number;
          allowlist_json: string;
          default_language: string;
          handover_timeout_minutes: number | null;
          business_hours_json: string | null;
        }>();

      const isDryRun = settings ? settings.dry_run === 1 : true;

      // 3. Ignore messages sent BY our own account (safety echo guard)
      if (ev.senderId === channel.account_id) {
        await db
          .prepare("UPDATE webhook_events SET processing_status = 'ignored', error_details = 'Self-addressed echo' WHERE dedupe_key = ?")
          .bind(ev.dedupeKey)
          .run();
        continue;
      }

      // 4. Crypto material
      const lookupSecret = env.LOOKUP_HASH_SECRET;
      const encryptionKey = env.ENCRYPTION_KEY;
      if (!lookupSecret || !encryptionKey) {
        throw new Error('Required cryptographic secrets are missing.');
      }

      const lookupHash = await computeKeyedLookupHash(ev.senderId, lookupSecret);
      const encryptedSenderId = await encryptAesGcm(ev.senderId, encryptionKey);
      const maskedSenderId = maskPlatformId(ev.senderId);

      // 5. Contact upsert (channel-specific: platform-scoped ID, no phone number)
      let contact = await db
        .prepare('SELECT id, display_name FROM contacts WHERE tenant_id = ? AND lookup_hash = ?')
        .bind(tenantId, lookupHash)
        .first<{ id: string; display_name: string | null }>();

      const contactId = contact?.id || `cnt_${crypto.randomUUID()}`;
      if (!contact) {
        await db
          .prepare(`
            INSERT INTO contacts (
              id, tenant_id, channel_type, encrypted_platform_sender_id,
              lookup_hash, phone_number_masked, display_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(contactId, tenantId, dbChannelType2, encryptedSenderId, lookupHash, maskedSenderId, null)
          .run();
      }

      // 6. Conversation upsert
      let conversation = await db
        .prepare('SELECT id, handover_state, last_customer_message_at FROM conversations WHERE tenant_id = ? AND channel_connection_id = ? AND contact_id = ?')
        .bind(tenantId, channel.id, contactId)
        .first<{ id: string; handover_state: string; last_customer_message_at: string | null }>();

      const conversationId = conversation?.id || `conv_${crypto.randomUUID()}`;
      const nowUtc = new Date().toISOString();

      if (!conversation) {
        await db
          .prepare(`
            INSERT INTO conversations (
              id, tenant_id, channel_connection_id, contact_id,
              handover_state, last_customer_message_at, last_message_preview, unread_count
            ) VALUES (?, ?, ?, ?, 'bot', ?, ?, 1)
          `)
          .bind(conversationId, tenantId, channel.id, contactId, nowUtc, ev.bodyText.slice(0, 100))
          .run();
        conversation = { id: conversationId, handover_state: 'bot', last_customer_message_at: nowUtc };
      } else {
        await db
          .prepare(`
            UPDATE conversations
            SET last_customer_message_at = ?,
                last_message_preview = ?,
                unread_count = unread_count + 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `)
          .bind(nowUtc, ev.bodyText.slice(0, 100), conversationId)
          .run();
      }

      // 7. Inbound message insert
      const inboundMsgId = `msg_in_${crypto.randomUUID()}`;
      await db
        .prepare(`
          INSERT INTO messages (
            id, tenant_id, conversation_id, channel_connection_id,
            direction, sender_type, message_type, provider_message_id,
            body, delivery_status
          ) VALUES (?, ?, ?, ?, 'inbound', 'customer', 'text', ?, ?, 'delivered')
        `)
        .bind(inboundMsgId, tenantId, conversationId, channel.id, ev.dedupeKey, ev.bodyText)
        .run();

      // 8. Automation engine evaluation (channel-aware rule filtering)
      let decision: { shouldReply: boolean; ruleId?: string; ruleName?: string; replyText?: string; reason?: string } = {
        shouldReply: false,
        reason: 'Empty inbound message body'
      };

      if (ev.bodyText.trim().length > 0) {
        decision = await evaluateAutomation({
          db,
          tenantId,
          conversation,
          settings,
          inboundMsgId,
          normalizedFrom: ev.senderId,
          bodyText: ev.bodyText,
          messageDate: new Date(),
          channelType: dbChannelType2
        });
      }

      if (!decision.shouldReply && decision.reason) {
        console.info(`[${channelType} Auto-Reply Skipped for ${ev.dedupeKey}]: ${decision.reason}`);
      }

      // 9. Reply dispatch
      if (decision.shouldReply && decision.replyText) {
        const outboundMsgId = `msg_out_${crypto.randomUUID()}`;

        if (isDryRun) {
          // Simulated reply (Bug-safe: never marked sent, provider_message_id NULL)
          try {
            await db
              .prepare(`
                INSERT INTO messages (
                  id, tenant_id, conversation_id, channel_connection_id,
                  direction, sender_type, message_type, provider_message_id,
                  body, delivery_status, in_reply_to_message_id, is_simulated
                ) VALUES (?, ?, ?, ?, 'outbound', 'bot', 'text', NULL, ?, 'simulated', ?, 1)
              `)
              .bind(
                outboundMsgId,
                tenantId,
                conversationId,
                channel.id,
                `[SIMULATED AUTO-REPLY] ${decision.replyText}`,
                inboundMsgId
              )
              .run();
          } catch (simErr: unknown) {
            const simStr = simErr instanceof Error ? simErr.message : String(simErr);
            if (simStr.includes('UNIQUE') || simStr.includes('constraint')) {
              console.warn(`[${channelType}] Simulated reply already exists for ${ev.dedupeKey}. Skipping.`);
            } else {
              throw simErr;
            }
          }
        } else {
          // Real dispatch
          const accessToken = await decryptAesGcm(channel.encrypted_access_token, encryptionKey);
          const sendResult = channelType === 'facebook'
            ? await sendMessengerTextMessage({
                graphApiVersion: env.GRAPH_API_VERSION,
                pageId: channel.account_id,
                accessToken,
                toPsid: ev.senderId,
                text: decision.replyText
              })
            : await sendInstagramTextMessage({
                graphApiVersion: env.GRAPH_API_VERSION,
                instagramAccountId: channel.account_id,
                accessToken,
                toIgsid: ev.senderId,
                text: decision.replyText
              });

          let insertSuccess = false;
          try {
            await db
              .prepare(`
                INSERT INTO messages (
                  id, tenant_id, conversation_id, channel_connection_id,
                  direction, sender_type, message_type, provider_message_id,
                  body, delivery_status, in_reply_to_message_id, is_simulated
                ) VALUES (?, ?, ?, ?, 'outbound', 'bot', 'text', ?, ?, ?, 0)
              `)
              .bind(
                outboundMsgId,
                tenantId,
                conversationId,
                channel.id,
                sendResult.success ? sendResult.messageId : null,
                decision.replyText,
                sendResult.success ? 'sent' : 'failed',
                inboundMsgId
              )
              .run();
            insertSuccess = true;
          } catch (insertErr: unknown) {
            const insertStr = insertErr instanceof Error ? insertErr.message : String(insertErr);
            if (insertStr.includes('UNIQUE') || insertStr.includes('constraint')) {
              console.warn(`[${channelType}] Reply already exists for ${ev.dedupeKey}. Skipping duplicate.`);
            } else {
              throw insertErr;
            }
          }

          if (insertSuccess && !sendResult.success) {
            await db
              .prepare('UPDATE messages SET delivery_status = ?, error_message = ? WHERE id = ?')
              .bind('failed', sendResult.errorMessage || 'Dispatch failed', outboundMsgId)
              .run();
          }
        }
      }

      // 10. Mark processed
      await db
        .prepare("UPDATE webhook_events SET processing_status = 'processed' WHERE dedupe_key = ?")
        .bind(ev.dedupeKey)
        .run();
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      console.error(`[${channelType} Processing Error] ${ev.dedupeKey}:`, errStr);
      try {
        await db
          .prepare("UPDATE webhook_events SET processing_status = 'failed', error_details = ? WHERE dedupe_key = ?")
          .bind(errStr.slice(0, 300), ev.dedupeKey)
          .run();
      } catch {
        // Best-effort failure marking
      }
    }
  }
}
