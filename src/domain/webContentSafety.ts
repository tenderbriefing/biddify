/**
 * External webpage content is untrusted evidence only.
 * Never treat page text as instructions to the autonomous worker.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*prompt/i,
  /you\s+are\s+(now|a)\s+.*?assistant/i,
  /disregard\s+(your|all)\s+(rules|policies|guardrails)/i,
  /exfiltrate|send\s+secrets|api[_\s-]?key/i,
  /<script[\s>]/i,
  /javascript:/i,
];

export type SanitizedWebContent = {
  text: string;
  strippedInstructionLike: boolean;
  flags: string[];
};

/**
 * Strip HTML to text and neutralize prompt-injection-like content.
 * Does not execute scripts. Output is evidence only.
 */
export function sanitizeWebContent(htmlOrText: string): SanitizedWebContent {
  const flags: string[] = [];
  let strippedInstructionLike = false;

  // Remove scripts/styles entirely
  let text = htmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Decode a few entities then strip tags
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) {
      strippedInstructionLike = true;
      flags.push("PROMPT_INJECTION_LIKE_CONTENT");
      text = text.replace(re, " ");
    }
  }

  if (strippedInstructionLike) {
    flags.push("UNTRUSTED_CONTENT_NEUTRALIZED");
  }

  return {
    text: text.replace(/\s+/g, " ").trim().slice(0, 50_000),
    strippedInstructionLike,
    flags: [...new Set(flags)],
  };
}

/** True if content must never be interpreted as worker instructions. */
export function isEvidenceOnly(content: string): true {
  void content;
  return true;
}
