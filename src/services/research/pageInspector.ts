/**
 * Inspect product pages and extract structured evidence.
 * Page content is untrusted — sanitize before use.
 */

import type { HttpClient } from "./httpClient";
import { sanitizeWebContent } from "@/domain/webContentSafety";
import {
  extractUsablePrice,
  parseZarAmount,
  type ExtractedPrice,
} from "@/domain/priceExtraction";
import { extractDeliveryFromText, type DeliveryEvidence } from "@/domain/deliveryEvidence";
import { parsePackSize } from "@/domain/packNormalization";
import { classifySource, evidenceLevelForSource } from "@/domain/sourceClassification";

export type InspectedProductPage = {
  url: string;
  finalUrl: string;
  ok: boolean;
  failure?: string;
  productName: string | null;
  brand: string | null;
  modelSku: string | null;
  description: string | null;
  price: ExtractedPrice;
  packSize: number | null;
  availability: string | null;
  delivery: DeliveryEvidence;
  attributes: string[];
  sourceType: string;
  sourceQuality: number;
  evidenceLevel: ReturnType<typeof evidenceLevelForSource>;
  retrievedAt: Date;
  safetyFlags: string[];
  rawTextExcerpt: string;
};

export async function inspectProductPage(
  http: HttpClient,
  url: string,
): Promise<InspectedProductPage> {
  const retrievedAt = new Date();
  const classified = classifySource(url);
  const res = await http.get(url);

  if (!res.ok) {
    return emptyResult(url, classified, retrievedAt, res.error || "PAGE_FETCH_FAILED");
  }

  if (/captcha|access denied|blocked/i.test(res.body.slice(0, 2000))) {
    return emptyResult(url, classified, retrievedAt, "PAGE_BLOCKED");
  }

  const sanitized = sanitizeWebContent(res.body);
  const text = sanitized.text;
  const title =
    res.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
    res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ||
    text.slice(0, 120) ||
    null;

  const brand =
    text.match(/\bBrand[:\s]+([A-Za-z0-9][A-Za-z0-9 &\-]{1,40})/i)?.[1] ||
    title?.match(
      /\b(Duracell|Energizer|HP|Dell|Lenovo|Samsung|Apple|Epson)\b/i,
    )?.[1] ||
    null;

  const sku =
    text.match(/\b(?:SKU|Model|MPN)[:\s#]*([A-Za-z0-9][A-Za-z0-9\-]{2,30})/i)?.[1] ||
    null;

  const amount = parseZarAmount(text);
  const saleCtx = /was\s*r|save\s*r|special|sale/i.test(text);
  const price = extractUsablePrice({
    amount,
    saleAmount: saleCtx ? amount : null,
    contextText: text.slice(0, 4000),
    outOfStock: /out\s*of\s*stock/i.test(text),
    memberOnly: /member\s*price|smart\s*shopper/i.test(text),
    fromPrice: /\bfrom\s*r\s*\d/i.test(text),
  });

  const packSize = parsePackSize(text) ?? parsePackSize(title ?? "");
  const availability = /in\s*stock/i.test(text)
    ? "IN_STOCK"
    : /out\s*of\s*stock/i.test(text)
      ? "OUT_OF_STOCK"
      : null;

  const delivery = extractDeliveryFromText(text, res.finalUrl || url);
  const attributes: string[] = [];
  for (const token of extractSizes(text + " " + (title ?? ""))) {
    attributes.push(token);
  }

  return {
    url,
    finalUrl: res.finalUrl || url,
    ok: true,
    productName: title,
    brand,
    modelSku: sku,
    description: text.slice(0, 500),
    price,
    packSize,
    availability,
    delivery,
    attributes,
    sourceType: classified.sourceType,
    sourceQuality: classified.qualityScore,
    evidenceLevel: evidenceLevelForSource(classified.sourceType),
    retrievedAt,
    safetyFlags: sanitized.flags,
    rawTextExcerpt: text.slice(0, 1500),
  };
}

function emptyResult(
  url: string,
  classified: ReturnType<typeof classifySource>,
  retrievedAt: Date,
  failure: string,
): InspectedProductPage {
  return {
    url,
    finalUrl: url,
    ok: false,
    failure,
    productName: null,
    brand: null,
    modelSku: null,
    description: null,
    price: {
      rawObservedPrice: null,
      normalizedUsablePrice: null,
      priceType: "UNKNOWN_PRICE_TYPE",
      vatTreatment: "UNKNOWN",
      usableForAutonomousPricing: false,
      normalizationNotes: [failure],
      riskFlags: [failure],
    },
    packSize: null,
    availability: null,
    delivery: {
      type: "UNKNOWN_DELIVERY",
      amount: null,
      threshold: null,
      destinationAssumption: null,
      source: url,
      known: false,
      notes: [failure],
    },
    attributes: [],
    sourceType: classified.sourceType,
    sourceQuality: classified.qualityScore,
    evidenceLevel: evidenceLevelForSource(classified.sourceType),
    retrievedAt,
    safetyFlags: [],
    rawTextExcerpt: "",
  };
}

function extractSizes(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d+(?:\.\d+)?)\s*(ml|g|kg|mm|m|meter|metre|l|volt|v)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`${m[1]}${m[2].toLowerCase()}`);
  }
  if (/\baaa\b/i.test(text)) out.push("aaa");
  else if (/\baa\b/i.test(text)) out.push("aa");
  return [...new Set(out)].slice(0, 12);
}
