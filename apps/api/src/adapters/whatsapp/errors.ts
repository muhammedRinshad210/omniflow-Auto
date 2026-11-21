/**
 * Meta WhatsApp Cloud API Error Code Mappings & Citations
 *
 * Official Documentation Sources:
 * 1. WhatsApp Cloud API Error Codes:
 *    https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 * 2. Meta Graph API Error Handling:
 *    https://developers.facebook.com/docs/graph-api/guides/error-handling/
 */

export interface MappedMetaError {
  code: number;
  isVerified: boolean;
  citationUrl: string;
  plainMessage: string;
}

export const VERIFIED_META_ERRORS: Record<number, MappedMetaError> = {
  // Error 190: Access Token Expired or Invalid (OAuth Exception)
  190: {
    code: 190,
    isVerified: true,
    citationUrl: 'https://developers.facebook.com/docs/graph-api/guides/error-handling/',
    plainMessage: 'Meta access token has expired or is invalid. Please reconnect WhatsApp in Settings.'
  },

  // Error 131005: Access Denied / Permission Error
  131005: {
    code: 131005,
    isVerified: true,
    citationUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
    plainMessage: 'WhatsApp permission denied. Verify that your Meta System User has the whatsapp_business_messaging permission.'
  },

  // Error 131047: Re-engagement message / Outside 24-Hour Window
  131047: {
    code: 131047,
    isVerified: true,
    citationUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
    plainMessage: 'Customer care window expired (over 24 hours). The customer must send a new message or you must use an approved template.'
  },

  // Error 130429: Rate Limit Hit
  130429: {
    code: 130429,
    isVerified: true,
    citationUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
    plainMessage: 'WhatsApp messaging rate limit reached. Outbound reply delayed.'
  },

  // Error 131026: Message Undeliverable
  131026: {
    code: 131026,
    isVerified: true,
    citationUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
    plainMessage: 'Message could not be delivered to this recipient on WhatsApp.'
  }
};

/**
 * Maps a Meta numeric error code to a plain-language human message.
 * If the error code is unmapped / unverified, returns a safe generic message retaining the raw code.
 */
export function mapMetaErrorCode(code?: number, details?: string): string {
  if (typeof code === 'number' && VERIFIED_META_ERRORS[code]) {
    return VERIFIED_META_ERRORS[code].plainMessage;
  }

  const codeStr = typeof code === 'number' ? `Meta error code: ${code}` : 'Unknown error';
  const detailsStr = details ? ` - ${details}` : '';
  return `WhatsApp message delivery failed (${codeStr}${detailsStr}).`;
}
