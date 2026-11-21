import { mapMetaErrorCode } from './errors.ts';

export interface SendWhatsAppTextMessageParams {
  graphApiVersion?: string;
  phoneNumberId: string;
  accessToken: string;
  toWaId: string;
  text: string;
  fetchFn?: typeof fetch;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Meta Graph API Outbound Message Client
 * Endpoint: POST https://graph.facebook.com/{version}/{phone_number_id}/messages
 */
export async function sendWhatsAppTextMessage(
  params: SendWhatsAppTextMessageParams
): Promise<SendWhatsAppResult> {
  const version = params.graphApiVersion || 'v22.0';
  const url = `https://graph.facebook.com/${version}/${params.phoneNumberId}/messages`;
  const fetchImpl = params.fetchFn || fetch;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.toWaId,
      type: 'text',
      text: {
        preview_url: false,
        body: params.text
      }
    };

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await res.json() as {
      messages?: Array<{ id: string }>;
      error?: {
        message?: string;
        code?: number;
        error_data?: { details?: string };
      };
    };

    if (res.ok && data.messages && data.messages.length > 0) {
      return {
        success: true,
        messageId: data.messages[0].id
      };
    }

    const code = data.error?.code;
    const details = data.error?.error_data?.details || data.error?.message;
    const plainError = mapMetaErrorCode(code, details);

    return {
      success: false,
      errorCode: code,
      errorMessage: plainError
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort
      ? 'Request timed out after 10 seconds while contacting WhatsApp servers.'
      : (err instanceof Error ? err.message : 'Network error contacting WhatsApp servers');

    return {
      success: false,
      errorMessage: message
    };
  }
}
