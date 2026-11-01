import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Secrets kept in the database (AI keys, docs/api/workspaces.md §2d): AES-256-GCM
// under AI_CONFIG_SECRET, so a database dump alone doesn't give them away.
// Stored as iv.tag.ciphertext, each base64.
export const MIN_SECRET_LENGTH = 32;

function keyFrom(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`AI_CONFIG_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

// Throws if the value was changed or the secret is a different one.
export function decryptSecret(stored: string, secret: string): string {
  const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Not an encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
