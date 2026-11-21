import { detectLanguageFromScript } from './language.ts';
import { normalizePhoneNumber } from './masking.ts';

export interface KeywordTriggerConfig {
  keywords: string[];
  match?: 'contains' | 'exact' | 'starts_with';
}

export interface BusinessHoursConfig {
  startHour: number;
  endHour: number;
  timezone?: string;
}

export interface AutomationRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  channel_type: string;
  trigger_type: string;
  trigger_config_json: string;
  response_type: string;
  response_content_json: string;
  priority: number;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface AutomationDecision {
  shouldReply: boolean;
  ruleId?: string;
  ruleName?: string;
  replyText?: string;
  reason?: string;
}

export interface EvaluateAutomationParams {
  db: D1Database;
  tenantId: string;
  conversation: {
    id: string;
    handover_state: string;
    last_customer_message_at?: string | null;
    updated_at?: string;
  };
  settings?: {
    automation_mode?: string;
    dry_run?: number;
    allowlist_json?: string;
    default_language?: string;
    handover_timeout_minutes?: number | null;
    business_hours_json?: string | null;
  } | null;
  inboundMsgId: string;
  normalizedFrom: string;
  bodyText: string;
  messageDate?: Date;
  /** Optional channel filter: only rules with this channel_type or 'all' are evaluated. */
  channelType?: 'whatsapp' | 'instagram' | 'messenger';
}

/**
 * Checks if the given date falls within the configured business hours.
 * If configJson is null/empty/invalid, returns true (always on).
 */
export function isWithinBusinessHours(
  configJson: string | null | undefined,
  messageDate: Date = new Date()
): boolean {
  if (!configJson || typeof configJson !== 'string' || configJson.trim().length === 0) {
    return true;
  }

  try {
    const config = JSON.parse(configJson) as BusinessHoursConfig;
    if (typeof config.startHour !== 'number' || typeof config.endHour !== 'number') {
      return true;
    }

    const tz = config.timezone || 'Asia/Kolkata';

    // Format hour in target timezone using standard Intl API
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false
    });

    const parts = formatter.formatToParts(messageDate);
    const hourPart = parts.find((p) => p.type === 'hour');
    let localHour = hourPart ? parseInt(hourPart.value, 10) : messageDate.getUTCHours();
    if (localHour === 24) localHour = 0; // Some engines format midnight as 24

    return localHour >= config.startHour && localHour < config.endHour;
  } catch {
    return true; // Fail-safe: if config cannot be parsed, treat as always on
  }
}

/**
 * Checks if human handover has expired according to tenant_settings.handover_timeout_minutes.
 * Per Correction 1: Queries messages table for sender_type = 'human_agent'.
 */
export async function isHandoverExpired(
  db: D1Database,
  tenantId: string,
  conversationId: string,
  timeoutMinutes: number | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (timeoutMinutes === null || timeoutMinutes === undefined || timeoutMinutes <= 0) {
    return false; // Null or non-positive timeout means indefinite pause until manual reset
  }

  const latestAgentMsg = await db
    .prepare(
      `SELECT created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND sender_type = 'human_agent'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(tenantId, conversationId)
    .first<{ created_at: string }>();

  if (latestAgentMsg && latestAgentMsg.created_at) {
    const agentTime = Date.parse(latestAgentMsg.created_at);
    if (!isNaN(agentTime)) {
      return (now.getTime() - agentTime) > timeoutMinutes * 60 * 1000;
    }
  }

  // Fallback: If no human_agent message has been logged yet, check conversation updated_at
  const conv = await db
    .prepare(`SELECT updated_at FROM conversations WHERE tenant_id = ? AND id = ?`)
    .bind(tenantId, conversationId)
    .first<{ updated_at: string }>();

  if (conv && conv.updated_at) {
    const convTime = Date.parse(conv.updated_at);
    if (!isNaN(convTime)) {
      return (now.getTime() - convTime) > timeoutMinutes * 60 * 1000;
    }
  }

  return false;
}

/**
 * Checks whether an inbound message has already received an outbound auto-reply.
 */
export async function hasAlreadyReplied(
  db: D1Database,
  tenantId: string,
  inboundMsgId: string
): Promise<boolean> {
  const existing = await db
    .prepare(
      `SELECT id FROM messages
       WHERE tenant_id = ? AND in_reply_to_message_id = ?
       LIMIT 1`
    )
    .bind(tenantId, inboundMsgId)
    .first<{ id: string }>();

  return existing !== null;
}

/**
 * Evaluates a single keyword against text according to matchType.
 * Supports exact Unicode comparison for Malayalam and case-insensitive comparison for Latin.
 */
export function matchSingleKeyword(
  text: string,
  kw: string,
  matchType: 'contains' | 'exact' | 'starts_with'
): boolean {
  const trimmedKw = kw.trim();
  if (trimmedKw.length === 0) return false;

  const isMalayalam = /[\u0D00-\u0D7F]/.test(trimmedKw);

  if (isMalayalam) {
    // Exact Unicode comparison for Malayalam script (no accent or case modification)
    const trimmedText = text.trim();
    if (matchType === 'exact') {
      return trimmedText === trimmedKw;
    } else if (matchType === 'starts_with') {
      return trimmedText.startsWith(trimmedKw);
    } else {
      return text.includes(trimmedKw);
    }
  } else {
    // Case-insensitive comparison for Latin script
    const lowerText = text.toLowerCase();
    const lowerTrimmedText = text.trim().toLowerCase();
    const lowerKw = trimmedKw.toLowerCase();

    if (matchType === 'exact') {
      return lowerTrimmedText === lowerKw;
    } else if (matchType === 'starts_with') {
      return lowerTrimmedText.startsWith(lowerKw);
    } else {
      return lowerText.includes(lowerKw);
    }
  }
}

/**
 * Parses and matches a rule's trigger configuration against inbound text.
 * Per Correction 2: Supports BOTH:
 *  (a) Legacy format: trigger_type 'keyword_exact' | 'keyword_contains' | 'keyword_starts_with' with array config
 *  (b) New format: trigger_type 'keyword' with object config { keywords: [...], match: 'contains'|'exact'|'starts_with' }
 */
export function checkRuleMatch(rule: AutomationRuleRow, inboundText: string): boolean {
  if (rule.trigger_type === 'default_fallback') {
    return false; // default_fallback is handled separately as a catch-all
  }

  try {
    const rawParsed = JSON.parse(rule.trigger_config_json);

    let keywords: string[] = [];
    let matchType: 'contains' | 'exact' | 'starts_with' = 'contains';

    if (Array.isArray(rawParsed)) {
      // Legacy format: array of strings
      keywords = rawParsed.filter((k): k is string => typeof k === 'string');
      if (rule.trigger_type === 'keyword_exact') {
        matchType = 'exact';
      } else if (rule.trigger_type === 'keyword_starts_with') {
        matchType = 'starts_with';
      } else {
        matchType = 'contains';
      }
    } else if (typeof rawParsed === 'object' && rawParsed !== null) {
      // New format: { keywords: [...], match: '...' }
      if (Array.isArray(rawParsed.keywords)) {
        keywords = rawParsed.keywords.filter((k: unknown): k is string => typeof k === 'string');
      }
      if (rawParsed.match === 'exact' || rawParsed.match === 'starts_with' || rawParsed.match === 'contains') {
        matchType = rawParsed.match;
      } else if (rule.trigger_type === 'keyword_exact') {
        matchType = 'exact';
      } else if (rule.trigger_type === 'keyword_starts_with') {
        matchType = 'starts_with';
      }
    }

    if (keywords.length === 0) return false;

    return keywords.some((kw) => matchSingleKeyword(inboundText, kw, matchType));
  } catch {
    return false; // Malformed rule JSON ignored safely
  }
}

/**
 * Resolves bilingual response content based on language detection of the inbound message.
 * Fallback priority: detectedLang -> 'en' -> first available non-empty key -> raw content.
 */
export function resolveBilingualResponse(
  responseContentJson: string,
  inboundText: string,
  defaultLanguage: string = 'ml'
): string {
  const detectedLang = detectLanguageFromScript(inboundText, defaultLanguage);

  try {
    const parsed = JSON.parse(responseContentJson);
    if (typeof parsed === 'string') {
      return parsed;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const content = parsed as Record<string, string>;

      // 1. Detected language match
      if (content[detectedLang] && typeof content[detectedLang] === 'string' && content[detectedLang].trim().length > 0) {
        return content[detectedLang];
      }

      // 2. English fallback
      if (content['en'] && typeof content['en'] === 'string' && content['en'].trim().length > 0) {
        return content['en'];
      }

      // 3. First available non-empty string value
      for (const key of Object.keys(content)) {
        if (content[key] && typeof content[key] === 'string' && content[key].trim().length > 0) {
          return content[key];
        }
      }
    }
  } catch {
    // If not JSON, return as plain text
  }

  return responseContentJson;
}

/**
 * Main Automation Engine Entrypoint.
 * Evaluates all safety guards, handover, business hours, and rule matching.
 */
export async function evaluateAutomation(params: EvaluateAutomationParams): Promise<AutomationDecision> {
  const {
    db,
    tenantId,
    conversation,
    settings,
    inboundMsgId,
    normalizedFrom,
    bodyText,
    messageDate = new Date(),
    channelType
  } = params;

  // 1. Human Handover Guard with Timeout Expiry
  if (conversation.handover_state !== 'bot') {
    const expired = await isHandoverExpired(
      db,
      tenantId,
      conversation.id,
      settings?.handover_timeout_minutes,
      messageDate
    );
    if (!expired) {
      return {
        shouldReply: false,
        reason: `Human handover active (${conversation.handover_state})`
      };
    }
    // Handover expired -> automation resumes automatically!
  }

  // 2. Automation Mode & Allowlist Guard (fail-closed)
  const automationMode = settings?.automation_mode || 'off';
  if (automationMode === 'off') {
    return { shouldReply: false, reason: 'Automation mode is OFF' };
  }

  if (automationMode === 'test') {
    let allowlist: string[] = [];
    try {
      allowlist = (JSON.parse(settings?.allowlist_json || '[]') as string[]).map((n) =>
        normalizePhoneNumber(String(n))
      );
    } catch {
      allowlist = [];
    }

    if (allowlist.length === 0 || !allowlist.includes(normalizedFrom)) {
      return { shouldReply: false, reason: 'Recipient not in test allowlist (fail closed)' };
    }
  }

  // 3. 24-hour Customer Care Window Guard
  if (conversation.last_customer_message_at) {
    const lastMsgTime = Date.parse(conversation.last_customer_message_at);
    if (!isNaN(lastMsgTime) && messageDate.getTime() - lastMsgTime > 24 * 3600 * 1000) {
      return { shouldReply: false, reason: 'Customer care window expired (over 24 hours)' };
    }
  }

  // 4. Inbound Message Content Check
  if (!bodyText || bodyText.trim().length === 0) {
    return { shouldReply: false, reason: 'Empty inbound message body' };
  }

  // 5. One Auto-Reply per Inbound Message Guard
  const alreadyReplied = await hasAlreadyReplied(db, tenantId, inboundMsgId);
  if (alreadyReplied) {
    return { shouldReply: false, reason: 'Inbound message already replied' };
  }

  // 6. Query Tenant Active Automation Rules
  // Ordered by priority DESC (higher priority wins), tiebreak by created_at ASC
  const rulesResult = channelType
    ? await db
        .prepare(
          `SELECT * FROM automation_rules
           WHERE tenant_id = ? AND is_active = 1 AND (channel_type = ? OR channel_type = 'all')
           ORDER BY priority DESC, created_at ASC`
        )
        .bind(tenantId, channelType)
        .all<AutomationRuleRow>()
    : await db
        .prepare(
          `SELECT * FROM automation_rules
           WHERE tenant_id = ? AND is_active = 1
           ORDER BY priority DESC, created_at ASC`
        )
        .bind(tenantId)
        .all<AutomationRuleRow>();

  const activeRules = rulesResult.results || [];
  if (activeRules.length === 0) {
    return { shouldReply: false, reason: 'No active automation rules for tenant' };
  }

  // 7. Away Hours (Business Hours) Evaluation
  const inBusinessHours = isWithinBusinessHours(settings?.business_hours_json, messageDate);

  let matchedRule: AutomationRuleRow | null = null;
  let fallbackRule: AutomationRuleRow | null = null;

  for (const rule of activeRules) {
    if (rule.trigger_type === 'default_fallback') {
      if (!fallbackRule) {
        fallbackRule = rule;
      }
      continue;
    }

    // Outside business hours: keyword rules do NOT fire (only fallback rule may fire)
    if (!inBusinessHours) {
      continue;
    }

    if (checkRuleMatch(rule, bodyText)) {
      matchedRule = rule;
      break; // First matching rule by priority wins
    }
  }

  const chosenRule = matchedRule || fallbackRule;
  if (!chosenRule) {
    return { shouldReply: false, reason: 'No matching rule found' };
  }

  // 8. Bilingual Response Resolution
  const defaultLang = settings?.default_language || 'ml';
  const replyText = resolveBilingualResponse(chosenRule.response_content_json, bodyText, defaultLang);

  return {
    shouldReply: true,
    ruleId: chosenRule.id,
    ruleName: chosenRule.name,
    replyText
  };
}
