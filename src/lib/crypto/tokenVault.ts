import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = 1;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function getSecret(): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("TOKEN_ENCRYPTION_KEY or AUTH_SECRET (≥16 chars) required for token vault");
  }
  return secret;
}

/** Encrypt a token string. Output is version:iv:tag:ciphertext (hex). Never log plaintext. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey(getSecret());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ver, ivHex, tagHex, dataHex] = payload.split(":");
  if (Number(ver) !== VERSION || !ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid token vault payload");
  }
  const key = deriveKey(getSecret());
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Redact tokens for logs/UI. */
export function redactToken(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length < 8) return "***";
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}
