/**
 * OmniFlow Script-Based Language Detection
 */

const MALAYALAM_SCRIPT_REGEX = /[\u0D00-\u0D7F]/;
const LATIN_SCRIPT_REGEX = /[a-zA-Z]/;

/**
 * Detect language ('ml' | 'en') based on character script.
 * If text contains Malayalam script, 'ml' is selected.
 * If text contains Latin characters, 'en' is selected.
 * If ambiguous / emoji only, falls back to the tenant's default_language.
 */
export function detectLanguageFromScript(text: string, defaultLanguage: string = 'ml'): string {
  if (!text || text.trim().length === 0) {
    return defaultLanguage;
  }

  if (MALAYALAM_SCRIPT_REGEX.test(text)) {
    return 'ml';
  }

  if (LATIN_SCRIPT_REGEX.test(text)) {
    return 'en';
  }

  return defaultLanguage;
}
