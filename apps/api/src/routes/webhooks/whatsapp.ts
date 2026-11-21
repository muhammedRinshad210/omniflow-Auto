import { Hono } from 'hono';
import type { Env } from '../../types/env.ts';
import {
  verifyMetaHmac,
  timingSafeStringEqual,
  encryptAesGcm,
  decryptAesGcm,
  computeKeyedLookupHash
} from '../../services/crypto.ts';
import { maskPhoneNumber, normalizePhoneNumber } from '../../services/masking.ts';
import { evaluateAutomation } from '../../services/automation.ts';
import { sendWhatsAppTextMessage } from '../../adapters/whatsapp/client.ts';
import { mapMetaErrorCode } from '../../adapters/whatsapp/errors.ts';

export const whatsappWebhookRouter = new Hono<{ Bindings: Env }>();

const STATUS_RANKS: Record<string, number> = {
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5
};

function isValidLookupHashSecret(secret?: string): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const trimmed = secret.trim();
  return trimmed.length >= 32 && trimmed.length % 2 === 0 && /^[0-9a-f]+$/i.test(trimmed);
}

function isValidEncryptionKey(key?: string): boolean {
  if (!key || typeof key !== 'string') return false;
  try {
    const raw = Uint8Array.from(atob(key.trim()), (c) => c.charCodeAt(0));
    return raw.byteLength === 32;
  } catch {
    return false;
  }
}

/**
 * GET /api/v1/webhooks/whatsapp
 * Meta Webhook Challenge Verification Handshake
 */
whatsappWebhookRouter.get('/whatsapp', (c) => {
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

/**
 * POST /api/v1/webhooks/whatsapp
 * Secure Webhook Ingestion & Background Dispatch Pipeline
 */
whatsappWebhookRouter.post('/whatsapp', async (c) => {
  const db = c.env.DB;
  const appSecret = c.env.META_APP_SECRET;

  if (!appSecret) {
    console.error('[WhatsApp Webhook] META_APP_SECRET is not configured in Worker secrets.');
    return c.json({ error: 'Server misconfiguration' }, 500);
  }

  // Cryptographic Secrets Guard: fail closed if missing or invalid hex (Bug 4)
  if (!isValidEncryptionKey(c.env.ENCRYPTION_KEY) || !isValidLookupHashSecret(c.env.LOOKUP_HASH_SECRET)) {
    console.error('[WhatsApp Webhook] Invalid or missing ENCRYPTION_KEY or LOOKUP_HASH_SECRET (must be valid 32-byte base64 and even-length hex).');
    return c.json({ error: 'Server misconfiguration: invalid or missing cryptographic secrets' }, 500);
  }

  // 1. Read Raw Buffer & Verify HMAC-SHA256 BEFORE parsing JSON
  const rawBody = await c.req.raw.arrayBuffer();
  const signatureHeader = c.req.header('X-Hub-Signature-256');

  const isValid = await verifyMetaHmac(rawBody, signatureHeader, appSecret);
  if (!isValid) {
    return c.json({ error: 'Invalid HMAC signature' }, 401);
  }

  // 2. Parse JSON safely
  let payload: any;
  try {
    const rawString = new TextDecoder().decode(rawBody);
    payload = JSON.parse(rawString);
  } catch {
    return c.json({ error: 'Malformed JSON payload' }, 400);
  }

  // 3. Extract items & Durable Ingestion
  const entries = payload?.entry;
  if (!Array.isArray(entries) || entries.length === 0) {
    return c.text('EVENT_RECEIVED', 200);
  }

  // PII Guard: Mask any sequence of 6 or more digits across raw preview (Bug 5)
  const rawPreview = JSON.stringify(payload)
    .replace(/\d{6,}/g, (d) => d.slice(0, 2) + '****' + d.slice(-2))
    .slice(0, 500);

  const eventsToProcess: Array<{
    tenantId: string;
    channelType: string;
    dedupeKey: string;
    eventType: 'message' | 'message_status';
    summaryJson: string;
    rawItem: any;
    phoneNumberId: string;
  }> = [];

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Check messages
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          const wamid = msg.id;
          if (!wamid) continue;

          eventsToProcess.push({
            tenantId: 'pending_lookup',
            channelType: 'whatsapp',
            dedupeKey: wamid,
            eventType: 'message',
            summaryJson: JSON.stringify({
              type: 'message',
              messageType: msg.type,
              fromMasked: maskPhoneNumber(msg.from || ''),
              timestamp: msg.timestamp
            }),
            rawItem: { ...value, currentMessage: msg },
            phoneNumberId
          });
        }
      }

      // Check statuses
      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          const wamid = status.id;
          if (!wamid) continue;

          const dedupeKey = `${wamid}:${status.status}:${status.timestamp}`;
          eventsToProcess.push({
            tenantId: 'pending_lookup',
            channelType: 'whatsapp',
            dedupeKey,
            eventType: 'message_status',
            summaryJson: JSON.stringify({
              type: 'status',
              status: status.status,
              wamid,
              timestamp: status.timestamp
            }),
            rawItem: { ...value, currentStatus: status },
            phoneNumberId
          });
        }
      }
    }
  }

  // 4. Durable Ingestion: Insert events into webhook_events as 'received' BEFORE returning 200
  const eventsToDispatch: typeof eventsToProcess = [];

  for (const ev of eventsToProcess) {
    // Look up tenant from channel_connections by phone_number_id
    const channel = await db
      .prepare('SELECT tenant_id FROM channel_connections WHERE channel_type = ? AND account_id = ?')
      .bind('whatsapp', ev.phoneNumberId)
      .first<{ tenant_id: string }>();

    // Unknown phone_number_id: skip event and continue loop (Bug 2 & Correction 1)
    if (!channel) {
      console.warn(`[WhatsApp Ingestion] Unregistered phone_number_id: ${ev.phoneNumberId}. Safely ignoring.`);
      continue;
    }

    ev.tenantId = channel.tenant_id;
    const eventId = `wh_${crypto.randomUUID()}`;

    try {
      await db
        .prepare(`
          INSERT INTO webhook_events (
            id, tenant_id, channel_type, event_type, dedupe_key,
            payload_summary_json, raw_payload_preview, processing_status, retention_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days'))
        `)
        .bind(
          eventId,
          ev.tenantId,
          ev.channelType,
          ev.eventType,
          ev.dedupeKey,
          ev.summaryJson,
          rawPreview
        )
        .run();

      eventsToDispatch.push(ev);
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('UNIQUE constraint failed')) {
        // Exact duplicate event received: log notice and CONTINUE loop without returning early (Bug 1)
        console.info(`[WhatsApp Ingestion] Duplicate event received (${ev.dedupeKey}). Safely skipping duplicate.`);
        continue;
      }
      console.error('[WhatsApp Ingestion Error] D1 insert failed:', errStr);
      // Non-duplicate insert failed: return 500 so Meta retries the delivery
      return c.text('Internal Server Error', 500);
    }
  }

  // 5. Immediate 200 Acknowledgement & Async Background Dispatch
  if (eventsToDispatch.length > 0) {
    let hasWaitUntil = false;
    try {
      const ctx = c.executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        hasWaitUntil = true;
        ctx.waitUntil(processWhatsAppEvents(c.env, eventsToDispatch));
      }
    } catch {
      hasWaitUntil = false;
    }

    if (!hasWaitUntil) {
      // Local Node / direct test fallback
      await processWhatsAppEvents(c.env, eventsToDispatch);
    }
  }

  return c.text('EVENT_RECEIVED', 200);
});

/**
 * Async Webhook Event Processing
 */
export async function processWhatsAppEvents(
  env: Env,
  events: Array<{
    tenantId: string;
    channelType: string;
    dedupeKey: string;
    eventType: 'message' | 'message_status';
    rawItem: any;
    phoneNumberId: string;
  }>
): Promise<void> {
  const db = env.DB;

  for (const ev of events) {
    try {
      // 1. Resolve channel connection
      const channel = await db
        .prepare(`
          SELECT id, tenant_id, encrypted_access_token, status
          FROM channel_connections
          WHERE channel_type = 'whatsapp' AND account_id = ?
        `)
        .bind(ev.phoneNumberId)
        .first<{
          id: string;
          tenant_id: string;
          encrypted_access_token: string;
          status: string;
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

      // 3. Handle Status Updates
      if (ev.eventType === 'message_status') {
        const statusItem = ev.rawItem.currentStatus;
        const wamid = statusItem.id;
        const newStatus = statusItem.status as string;

        const existingMsg = await db
          .prepare('SELECT id, delivery_status FROM messages WHERE channel_connection_id = ? AND provider_message_id = ?')
          .bind(channel.id, wamid)
          .first<{ id: string; delivery_status: string }>();

        if (existingMsg) {
          const currentRank = STATUS_RANKS[existingMsg.delivery_status] || 0;
          const newRank = STATUS_RANKS[newStatus] || 0;

          // Never downgrade status (e.g. read cannot become delivered)
          if (newRank >= currentRank) {
            let errorMsg: string | null = null;
            if (newStatus === 'failed') {
              const code = statusItem.errors?.[0]?.code;
              const details = statusItem.errors?.[0]?.error_data?.details || statusItem.errors?.[0]?.title;
              errorMsg = mapMetaErrorCode(code, details);
            }

            await db
              .prepare('UPDATE messages SET delivery_status = ?, error_message = ? WHERE id = ?')
              .bind(newStatus, errorMsg, existingMsg.id)
              .run();
          }
        }

        await db
          .prepare("UPDATE webhook_events SET processing_status = 'processed' WHERE dedupe_key = ?")
          .bind(ev.dedupeKey)
          .run();
        continue;
      }

      // 4. Handle Inbound Messages
      const msg = ev.rawItem.currentMessage;
      const rawFrom = String(msg.from || '');
      const normalizedFrom = normalizePhoneNumber(rawFrom);
      const maskedFrom = maskPhoneNumber(rawFrom);
      const profileName = ev.rawItem.contacts?.[0]?.profile?.name || null;
      const wamid = msg.id;
      const messageType = msg.type || 'text';
      const bodyText = messageType === 'text' ? (msg.text?.body || '') : `[${messageType.toUpperCase()} received]`;

      const lookupSecret = env.LOOKUP_HASH_SECRET;
      const encryptionKey = env.ENCRYPTION_KEY;

      if (!lookupSecret || !encryptionKey) {
        throw new Error('Required cryptographic secrets are missing.');
      }

      const lookupHash = await computeKeyedLookupHash(normalizedFrom, lookupSecret);
      const encryptedWaId = await encryptAesGcm(normalizedFrom, encryptionKey);

      // Contact upsert
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
            ) VALUES (?, ?, 'whatsapp', ?, ?, ?, ?)
          `)
          .bind(contactId, tenantId, encryptedWaId, lookupHash, maskedFrom, profileName)
          .run();
      } else if (profileName && profileName !== contact.display_name) {
        await db
          .prepare("UPDATE contacts SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
          .bind(profileName, contactId)
          .run();
      }

      // Conversation upsert
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
          .bind(conversationId, tenantId, channel.id, contactId, nowUtc, bodyText.slice(0, 100))
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
          .bind(nowUtc, bodyText.slice(0, 100), conversationId)
          .run();
      }

      // Inbound Message Insert
      const inboundMsgId = `msg_in_${crypto.randomUUID()}`;
      await db
        .prepare(`
          INSERT INTO messages (
            id, tenant_id, conversation_id, channel_connection_id,
            direction, sender_type, message_type, provider_message_id,
            body, delivery_status
          ) VALUES (?, ?, ?, ?, 'inbound', 'customer', ?, ?, ?, 'delivered')
        `)
        .bind(inboundMsgId, tenantId, conversationId, channel.id, messageType, wamid, bodyText)
        .run();

      // Auto-reply Evaluation via Phase 2 Automation Engine
      let decision: { shouldReply: boolean; ruleId?: string; ruleName?: string; replyText?: string; reason?: string } = {
        shouldReply: false,
        reason: 'Non-text message'
      };

      if (messageType === 'text') {
        decision = await evaluateAutomation({
          db,
          tenantId,
          conversation,
          settings,
          inboundMsgId,
          normalizedFrom,
          bodyText,
          messageDate: new Date(),
          channelType: 'whatsapp'
        });
      }

      if (!decision.shouldReply && decision.reason) {
        console.info(`[WhatsApp Auto-Reply Skipped for ${wamid}]: ${decision.reason}`);
      }

      if (decision.shouldReply && decision.replyText) {
        const outboundMsgId = `msg_out_${crypto.randomUUID()}`;

        if (isDryRun) {
          // Simulated reply: mark is_simulated = 1, delivery_status = 'simulated', provider_message_id = NULL
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
          } catch (insertErr: unknown) {
            const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
            if (errMsg.includes('UNIQUE') || errMsg.includes('constraint')) {
              console.warn(`[WhatsApp Auto-Reply] Inbound message ${inboundMsgId} was already replied. Safely skipping duplicate reply.`);
            } else {
              throw insertErr;
            }
          }
        } else {
          // Real dispatch: insert pending outbound row with unique in_reply_to_message_id
          let insertSuccess = false;
          try {
            await db
              .prepare(`
                INSERT INTO messages (
                  id, tenant_id, conversation_id, channel_connection_id,
                  direction, sender_type, message_type, provider_message_id,
                  body, delivery_status, in_reply_to_message_id, is_simulated
                ) VALUES (?, ?, ?, ?, 'outbound', 'bot', 'text', NULL, ?, 'pending', ?, 0)
              `)
              .bind(outboundMsgId, tenantId, conversationId, channel.id, decision.replyText, inboundMsgId)
              .run();
            insertSuccess = true;
          } catch (insertErr: unknown) {
            const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
            if (errMsg.includes('UNIQUE') || errMsg.includes('constraint')) {
              console.warn(`[WhatsApp Auto-Reply] Inbound message ${inboundMsgId} was already replied. Safely skipping duplicate reply.`);
            } else {
              throw insertErr;
            }
          }

          if (insertSuccess) {
            // Decrypt channel access token
            let decryptedToken: string;
            try {
              decryptedToken = await decryptAesGcm(channel.encrypted_access_token, encryptionKey);
            } catch (decErr) {
              await db
                .prepare("UPDATE messages SET delivery_status = 'failed', error_message = 'Failed to decrypt access token' WHERE id = ?")
                .bind(outboundMsgId)
                .run();
              throw decErr;
            }

            const sendResult = await sendWhatsAppTextMessage({
              graphApiVersion: env.GRAPH_API_VERSION,
              phoneNumberId: ev.phoneNumberId,
              accessToken: decryptedToken,
              toWaId: normalizedFrom,
              text: decision.replyText
            });

            if (sendResult.success && sendResult.messageId) {
              await db
                .prepare("UPDATE messages SET provider_message_id = ?, delivery_status = 'sent' WHERE id = ?")
                .bind(sendResult.messageId, outboundMsgId)
                .run();
            } else {
              await db
                .prepare("UPDATE messages SET delivery_status = 'failed', error_message = ? WHERE id = ?")
                .bind(sendResult.errorMessage || 'Failed to dispatch via Meta API', outboundMsgId)
                .run();
            }
          }
        }
      }

      await db
        .prepare("UPDATE webhook_events SET processing_status = 'processed' WHERE dedupe_key = ?")
        .bind(ev.dedupeKey)
        .run();
    } catch (itemErr: unknown) {
      const errMessage = itemErr instanceof Error ? itemErr.message : String(itemErr);
      console.error(`[WhatsApp Event Processing Error for ${ev.dedupeKey}]:`, errMessage);
      await db
        .prepare("UPDATE webhook_events SET processing_status = 'failed', error_details = ? WHERE dedupe_key = ?")
        .bind(errMessage, ev.dedupeKey)
        .run();
    }
  }
}
