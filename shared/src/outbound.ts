// Where the server may send a person's webhook / push requests (SEC-50, SEC-52).
// A member picks the URL, so without a check any account could aim the
// server at things only it can reach. Private-network addresses are refused
// unless ALLOW_PRIVATE_WEBHOOKS=true (self-hosting on a LAN); loopback,
// link-local (cloud metadata), multicast and this stack's own service names
// are refused either way. docs/api/notifications.md §1b "Where requests may go".
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class OutboundBlockedError extends Error {}

const PRIVATE_HINT = "This server doesn't allow addresses on a private network. Whoever runs it can allow them with ALLOW_PRIVATE_WEBHOOKS=true in its .env.";
const NEVER = "That address can't be used: it points at the server itself or a reserved range.";

// Names of this stack's own services (docker-compose.yml) and the machine itself.
const SERVICE_NAMES = new Set(["localhost", "redis", "db", "backend", "worker", "frontend"]);
const PRIVATE_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa", ".localdomain"];

type Kind = "public" | "private" | "never";

function classifyV4(ip: string): Kind {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 0 || a === 127 || a >= 224) return "never";
  if (a === 169 && b === 254) return "never";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
  return "public";
}

function classifyV6(ip: string): Kind {
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return classifyV4(mapped[1]!);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return classifyV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (s === "::" || s === "::1") return "never";
  if (/^fe[89ab]/.test(s) || s.startsWith("ff")) return "never";
  if (/^f[cd]/.test(s)) return "private";
  if (s.startsWith("64:ff9b:")) return "never"; // NAT64: could wrap any IPv4
  return "public";
}

function classifyIp(ip: string): Kind {
  return isIP(ip) === 4 ? classifyV4(ip) : classifyV6(ip);
}

function allowPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_WEBHOOKS?.trim().toLowerCase() === "true";
}

// Throws OutboundBlockedError (its message is safe to show) when the URL
// shouldn't be requested. A name that doesn't resolve passes: the request
// then fails by itself.
export async function assertOutboundAllowed(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlockedError("not a valid URL");
  }
  // The URL parser has already turned 2130706433, 0x7f000001 etc. into dotted form.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  let worst: Kind = "public";
  const note = (k: Kind): void => {
    if (k === "never" || (k === "private" && worst === "public")) worst = k;
  };
  if (isIP(host)) {
    note(classifyIp(host));
  } else {
    if (SERVICE_NAMES.has(host)) worst = "never";
    else if (host === "host.docker.internal" || !host.includes(".") || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) worst = "private";
    if (worst !== "never") {
      const found = await lookup(host, { all: true }).catch(() => []);
      for (const a of found) note(classifyIp(a.address));
    }
  }
  if (worst === "never") throw new OutboundBlockedError(NEVER);
  if (worst === "private" && !allowPrivate()) throw new OutboundBlockedError(PRIVATE_HINT);
}
