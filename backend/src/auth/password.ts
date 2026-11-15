import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; maxmem: number }
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// SEC-36: the cost is written into the stored hash, so raising it later keeps old hashes working.
const COST = 32768;
const LEGACY_COST = 16384; // hashes made before the cost was recorded
const scryptCost = (N: number) => ({ N, maxmem: 256 * N * 8 });

// Stored format: scrypt$<N>$<saltHex>$<hashHex> (older: scrypt$<saltHex>$<hashHex>)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, scryptCost(COST));
  return `scrypt$${COST}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  const withCost = parts.length === 4;
  const cost = withCost ? Number(parts[1]) : LEGACY_COST;
  const saltHex = parts[withCost ? 2 : 1];
  const hashHex = parts[withCost ? 3 : 2];
  // Powers of two only, capped, so a stored value can't ask for unbounded memory.
  if (parts[0] !== "scrypt" || !saltHex || !hashHex || !Number.isInteger(Math.log2(cost)) || cost < 1024 || cost > 1 << 20) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, scryptCost(cost));
  return timingSafeEqual(actual, expected);
}

// Hash of a random password, compared against when the email doesn't exist so
// login takes the same time whether or not the account is real.
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString("hex"));
