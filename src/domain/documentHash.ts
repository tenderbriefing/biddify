import { createHash } from "node:crypto";

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Skip reprocessing when content hash matches a previously stored document.
 */
export function shouldReprocessDocument(
  existingHash: string | null | undefined,
  newHash: string,
): boolean {
  if (!existingHash) return true;
  return existingHash !== newHash;
}
