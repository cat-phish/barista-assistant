import { readFileSync } from "node:fs";

// Environment/secret loading shared by backend and worker.
//
// Every secret NAME can come from either:
//   NAME       the value itself (local dev via .env)
//   NAME_FILE  a path to a file holding it, e.g. /run/secrets/... (Docker secrets)
// Setting both is an error, so it's never ambiguous which one is in effect.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export function optionalSecret(name: string): string | undefined {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) {
    throw new Error(`Set only one of ${name} and ${name}_FILE`);
  }
  if (file) {
    let value: string;
    try {
      value = readFileSync(file, "utf8").trim();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${name}_FILE: cannot read ${file}: ${reason}`);
    }
    if (!value) throw new Error(`${name}_FILE: ${file} is empty`);
    return value;
  }
  return direct || undefined;
}

export function requireSecret(name: string): string {
  const value = optionalSecret(name);
  if (!value) {
    throw new Error(`${name} (or ${name}_FILE) is not set`);
  }
  return value;
}

export interface ConnectionSettings {
  url: string;
  password: string | undefined;
}

// A connection URL plus its password, kept apart so the URL can be logged or
// shown without leaking the password. Refuses a password in both places,
// because mysql2 and ioredis disagree on which one wins.
export function connectionSettings(urlVar: string, passwordVar: string): ConnectionSettings {
  const url = requireEnv(urlVar);
  const password = optionalSecret(passwordVar);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${urlVar} is not a valid URL`);
  }
  if (parsed.password && password) {
    throw new Error(`${urlVar} already contains a password; remove it or unset ${passwordVar}`);
  }
  return { url, password };
}
