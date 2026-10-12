import type { EmailClassification } from "@prisma/client";

export type ClassificationResult = {
  classification: EmailClassification;
  confidence: number;
  needsReview: boolean;
};

/**
 * Conservative keyword classifier — low confidence → review.
 */
export function classifySupplierReply(input: {
  subject: string;
  body: string;
}): ClassificationResult {
  const text = `${input.subject}\n${input.body}`.toLowerCase();

  const rules: Array<{ classification: EmailClassification; re: RegExp; confidence: number }> = [
    { classification: "BOUNCE", re: /delivery status notification|undeliverable|mailbox unavailable/, confidence: 0.9 },
    { classification: "FORMAL_QUOTE", re: /quotation|quote\s*#|proforma|attached.*quote/, confidence: 0.75 },
    { classification: "OUT_OF_STOCK", re: /out of stock|no stock|unavailable/, confidence: 0.8 },
    { classification: "DECLINED", re: /\bdecline\b|unable to quote|not able to supply/, confidence: 0.8 },
    { classification: "NEED_MORE_INFORMATION", re: /more information|please clarify|need specs/, confidence: 0.7 },
    { classification: "ALTERNATIVE_PRODUCT", re: /alternative|equivalent product|substitute/, confidence: 0.65 },
    { classification: "OEM_AUTHORIZATION_INFO", re: /authorised reseller|oem letter|dealer authorisation/, confidence: 0.7 },
    { classification: "DELIVERY_INFORMATION", re: /delivery (cost|fee|charge)|lead time|ex works/, confidence: 0.65 },
    { classification: "PAYMENT_TERMS", re: /payment terms|cod\b|30 days|upfront/, confidence: 0.65 },
    { classification: "PRICE_IN_EMAIL", re: /r\s?\d|unit price|zar\s?\d/, confidence: 0.55 },
  ];

  for (const rule of rules) {
    if (rule.re.test(text)) {
      return {
        classification: rule.classification,
        confidence: rule.confidence,
        needsReview: rule.confidence < 0.7,
      };
    }
  }

  return { classification: "UNKNOWN", confidence: 0.2, needsReview: true };
}
