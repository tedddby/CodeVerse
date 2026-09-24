/**
 * The client address a request is rate limited under.
 *
 * `X-Forwarded-For` is a list that every proxy appends to, and whatever a
 * client sends ends up at its left: only the entries appended by the
 * deployment's own proxies can be trusted. With N trusted proxies the client
 * is the Nth entry from the right (`CODEVERSE_TRUSTED_PROXY_HOPS`, default 1:
 * one proxy such as nginx with `$proxy_add_x_forwarded_for`, a cloud load
 * balancer, or Vercel, which sends a single entry). Next.js itself only fills
 * the header when it is missing, so a server exposed without a proxy cannot
 * tell its clients apart reliably.
 *
 * Platforms that put the client address in a header of their own (overwritten
 * on every request) can name it with `CODEVERSE_CLIENT_IP_HEADER`, e.g.
 * `x-real-ip` behind nginx with `proxy_set_header X-Real-IP $remote_addr`.
 */

export interface ClientAddressConfig {
  /** Reverse proxies in front of the server that append to X-Forwarded-For (at least 1). */
  trustedProxyHops: number;
  /** Header the platform overwrites with the client address; takes precedence when present. */
  clientIpHeader?: string;
}

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 20;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

type Env = Record<string, string | undefined>;

/** Reads `CODEVERSE_TRUSTED_PROXY_HOPS` and `CODEVERSE_CLIENT_IP_HEADER` (invalid values are ignored). */
export function readClientAddressConfig(env: Env = process.env): ClientAddressConfig {
  const rawHops = env.CODEVERSE_TRUSTED_PROXY_HOPS?.trim();
  const hops = rawHops ? Number(rawHops) : Number.NaN;
  const config: ClientAddressConfig = {
    trustedProxyHops:
      Number.isInteger(hops) && hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS
        ? hops
        : DEFAULT_TRUSTED_PROXY_HOPS,
  };
  const header = env.CODEVERSE_CLIENT_IP_HEADER?.trim();
  if (header && HEADER_NAME.test(header)) config.clientIpHeader = header.toLowerCase();
  return config;
}

/** The client address of `request` according to `config`, or null when no header names one. */
export function clientAddress(
  request: Request,
  config: ClientAddressConfig = readClientAddressConfig(),
): string | null {
  if (config.clientIpHeader) {
    const platform = request.headers.get(config.clientIpHeader)?.trim();
    if (platform) return platform;
  }
  const entries = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length > 0) {
    // A shorter chain than configured (e.g. an internal health check) yields its leftmost entry.
    return entries[Math.max(0, entries.length - config.trustedProxyHops)] ?? null;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}
