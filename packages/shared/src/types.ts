/**
 * OmniFlow Shared Core Types & Interfaces
 * Channel-agnostic data transfer objects (DTOs) and domain models.
 */

export type ChannelType = 'whatsapp' | 'instagram' | 'messenger';

export type MessageDirection = 'inbound' | 'outbound';

export type SenderType = 'customer' | 'bot' | 'human_agent';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'interactive'
  | 'template';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ConversationStatus = 'open' | 'closed' | 'archived';

export type HandoverState = 'bot' | 'human_requested' | 'human_assigned';

export type TriggerType =
  | 'keyword_exact'
  | 'keyword_contains'
  | 'greeting'
  | 'default_fallback'
  | 'out_of_hours';

export type ResponseType = 'text' | 'template' | 'handover';

/**
 * Normalized Inbound Event DTO produced by channel adapters.
 * The shared automation engine consumes only this normalized format.
 */
export interface NormalizedInboundEvent {
  tenantId: string;
  channelType: ChannelType;
  channelAccountId: string;
  providerEventId: string;
  dedupeKey: string;
  senderRawId: string; // The raw recipient ID (wa_id, IGSID, PSID) to be encrypted at rest
  senderDisplayName?: string;
  messageType: MessageType;
  body?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  timestampUtc: string; // ISO-8601 with Z
  rawSummary: Record<string, unknown>;
}

/**
 * Normalized Outbound Message Request DTO dispatched to channel adapters.
 */
export interface NormalizedOutboundMessage {
  tenantId: string;
  channelType: ChannelType;
  channelAccountId: string;
  recipientRawId: string; // Decrypted wa_id, IGSID, or PSID
  messageType: MessageType;
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  conversationId: string;
}

/**
 * Health check response payload
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  app: string;
  version: string;
  timestamp: string;
  environment: string;
  uptimeSeconds: number;
}
