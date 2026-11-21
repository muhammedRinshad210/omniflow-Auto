/**
 * OmniFlow PII Masking & Normalization Utilities
 */

/**
 * Normalizes phone numbers by stripping all non-digit characters.
 */
export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Mask a phone number for display in logs and UI.
 * e.g. "919876543210" -> "+91 98**** 3210"
 */
export function maskPhoneNumber(raw: string): string {
  const digits = normalizePhoneNumber(raw);
  if (digits.length <= 4) {
    return '****';
  }

  const countryPrefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  const nationalDigits = digits.length > 10 ? digits.slice(-10) : digits;

  const firstTwo = nationalDigits.slice(0, 2);
  const lastFour = nationalDigits.slice(-4);

  return `${countryPrefix}${firstTwo}**** ${lastFour}`;
}
