/** Small HTTP helpers shared by the API route handlers. */

/** `Retry-After` value in whole seconds (at least 1). */
export function retryAfterSeconds(ms: number): string {
  return String(Math.max(1, Math.ceil(ms / 1000)));
}

/** Seconds until an ISO date, for `Retry-After` (undefined when absent or past). */
export function retryAfterFromIso(
  iso: string | undefined,
  now: number = Date.now(),
): string | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  if (Number.isNaN(time) || time <= now) return undefined;
  return retryAfterSeconds(time - now);
}

/** JSON response with explicit status and cache headers. */
export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
