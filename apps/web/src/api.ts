/**
 * OmniFlow Admin API client.
 * Auth: shared admin password sent as X-Admin-Password header (session-scoped).
 * All endpoints live under /api/v1/admin (same origin — Worker serves both SPA & API).
 */

const BASE = '/api/v1/admin';
const PW_KEY = 'omniflow.admin.pw';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getPassword(): string | null {
  try {
    return sessionStorage.getItem(PW_KEY);
  } catch {
    return null;
  }
}

export function setPassword(pw: string): void {
  try {
    sessionStorage.setItem(PW_KEY, pw);
  } catch {
    /* private mode — session auth will simply not persist */
  }
}

export function clearPassword(): void {
  try {
    sessionStorage.removeItem(PW_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const pw = getPassword() || '';
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': pw,
      ...(init.headers || {})
    }
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const msg = body?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

/* ============================== Types ============================== */

export type ChannelType = 'whatsapp' | 'instagram' | 'messenger';

export interface OverviewStats {
  active_accounts: number;
  active_rules: number;
  total_conversations: number;
  handover_conversations: number;
  total_inbound: number;
  total_outbound: number;
  messages_today: number;
}

export interface OverviewResponse {
  ok: boolean;
  tenantId: string;
  stats: OverviewStats;
}

export interface TenantSettings {
  tenant_id: string;
  automation_mode: 'off' | 'test' | 'live';
  dry_run: number;
  allowlist_json: string;
  default_language: 'en' | 'ml';
  handover_timeout_minutes: number | null;
  business_hours_json: string | null;
  updated_at?: string;
}

export interface BusinessHours {
  startHour: number;
  endHour: number;
  timezone?: string;
}

export interface AutomationRule {
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
  created_at: string;
  updated_at: string;
}

export interface RulePayload {
  name: string;
  channel_type: string;
  trigger_type: string;
  trigger_config_json: { keywords: string[]; match: string } | never[];
  response_content_json: Record<string, string>;
  priority: number;
  is_active: number;
}

export interface ChannelAccount {
  id: string;
  channel_type: ChannelType;
  account_id: string;
  name: string;
  token_preview: string;
  status: 'active' | 'disconnected' | 'expired';
  created_at: string;
}

export interface ConversationListItem {
  id: string;
  handover_state: 'bot' | 'human_requested' | 'human_assigned';
  last_message_preview: string | null;
  unread_count: number;
  last_customer_message_at: string | null;
  updated_at: string;
  channel_type: ChannelType;
  account_name: string;
  display_name: string | null;
  phone_number_masked: string | null;
}

export interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'bot' | 'human_agent';
  message_type: string;
  body: string | null;
  delivery_status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'simulated';
  is_simulated: number;
  error_message: string | null;
  created_at: string;
}

export interface ContactItem {
  id: string;
  channel_type: ChannelType;
  display_name: string | null;
  phone_number_masked: string | null;
  created_at: string;
  conversation_count: number;
  last_message_at: string | null;
}

export interface WebhookInfo {
  ok: boolean;
  baseUrl: string;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  webhooks: { whatsapp: string; instagram: string; messenger: string };
}

export interface DailyPoint {
  day: string;
  inbound: number;
  outbound: number;
}

/* ============================== API surface ============================== */

export const Api = {
  session: () => request<{ ok: boolean; app: string }>('/session'),

  overview: () => request<OverviewResponse>('/overview'),

  statsDaily: () => request<{ ok: boolean; series: DailyPoint[] }>('/stats/daily'),

  webhookInfo: () => request<WebhookInfo>('/webhook-info'),

  /* Settings */
  getSettings: () => request<{ ok: boolean; settings: TenantSettings | null }>('/settings'),
  putSettings: (payload: {
    automation_mode: string;
    dry_run: number;
    allowlist_json: string[] | string;
    default_language: string;
    handover_timeout_minutes: number | null;
    business_hours_json: BusinessHours | null;
  }) =>
    request<{ ok: boolean; settings: TenantSettings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),

  /* Rules */
  listRules: () => request<{ ok: boolean; rules: AutomationRule[] }>('/rules'),
  createRule: (payload: RulePayload) =>
    request<{ ok: boolean; rule: AutomationRule }>('/rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateRule: (id: string, payload: RulePayload) =>
    request<{ ok: boolean; rule: AutomationRule }>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/rules/${id}`, { method: 'DELETE' }),

  /* Accounts */
  listAccounts: () => request<{ ok: boolean; accounts: ChannelAccount[] }>('/accounts'),
  createAccount: (payload: { channel_type: string; account_id: string; access_token: string; name?: string }) =>
    request<{ ok: boolean; account: ChannelAccount }>('/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (id: string, payload: { name?: string; status?: string; access_token?: string }) =>
    request<{ ok: boolean; account: ChannelAccount }>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAccount: (id: string) => request<{ ok: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),

  /* Conversations */
  listConversations: (channel?: string) =>
    request<{ ok: boolean; conversations: ConversationListItem[] }>(
      `/conversations${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`
    ),
  listMessages: (conversationId: string) =>
    request<{ ok: boolean; messages: ChatMessage[] }>(`/conversations/${conversationId}/messages`),
  markRead: (conversationId: string) =>
    request<{ ok: boolean }>(`/conversations/${conversationId}/read`, { method: 'POST', body: JSON.stringify({}) }),
  sendReply: (conversationId: string, text: string) =>
    request<{ ok: boolean; simulated: boolean; message: ChatMessage }>(`/conversations/${conversationId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text })
    }),
  setHandover: (conversationId: string, state: 'bot' | 'human_requested' | 'human_assigned') =>
    request<{ ok: boolean; state: string }>(`/conversations/${conversationId}/handover`, {
      method: 'POST',
      body: JSON.stringify({ state })
    }),

  /* Contacts */
  listContacts: () => request<{ ok: boolean; contacts: ContactItem[] }>('/contacts')
};
