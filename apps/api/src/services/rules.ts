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
}

export interface MatchedRuleResult {
  ruleId: string;
  ruleName: string;
  replyText: string;
}

/**
 * Matches an inbound customer text against the tenant's automation rules.
 */
export function matchRule(
  rules: AutomationRuleRow[],
  inboundText: string,
  preferredLanguage: string = 'ml'
): MatchedRuleResult | null {
  const normalizedText = inboundText.trim().toLowerCase();

  let fallbackRule: AutomationRuleRow | null = null;

  for (const rule of rules) {
    if (rule.is_active !== 1) continue;

    if (rule.trigger_type === 'default_fallback') {
      if (!fallbackRule) {
        fallbackRule = rule;
      }
      continue;
    }

    try {
      const keywords = JSON.parse(rule.trigger_config_json) as string[];
      if (!Array.isArray(keywords)) continue;

      let matched = false;

      if (rule.trigger_type === 'keyword_exact') {
        matched = keywords.some(
          (kw) => typeof kw === 'string' && kw.trim().toLowerCase() === normalizedText
        );
      } else if (rule.trigger_type === 'keyword_contains') {
        matched = keywords.some(
          (kw) => typeof kw === 'string' && normalizedText.includes(kw.trim().toLowerCase())
        );
      }

      if (matched) {
        const replyText = extractLanguageResponse(rule.response_content_json, preferredLanguage);
        if (replyText) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            replyText
          };
        }
      }
    } catch {
      // Ignore malformed rule JSON and evaluate next rule
      continue;
    }
  }

  // Fallback rule evaluation if no keyword matched
  if (fallbackRule) {
    const replyText = extractLanguageResponse(fallbackRule.response_content_json, preferredLanguage);
    if (replyText) {
      return {
        ruleId: fallbackRule.id,
        ruleName: fallbackRule.name,
        replyText
      };
    }
  }

  return null;
}

/**
 * Extracts response text from JSON content based on language ('ml' or 'en').
 */
function extractLanguageResponse(responseContentJson: string, preferredLanguage: string): string | null {
  try {
    const content = JSON.parse(responseContentJson) as Record<string, string>;
    if (typeof content === 'string') {
      return content;
    }

    if (content[preferredLanguage]) {
      return content[preferredLanguage];
    }

    // Secondary fallback
    if (preferredLanguage === 'ml' && content['en']) {
      return content['en'];
    }
    if (preferredLanguage === 'en' && content['ml']) {
      return content['ml'];
    }

    const firstKey = Object.keys(content)[0];
    return firstKey ? content[firstKey] : null;
  } catch {
    return responseContentJson;
  }
}
