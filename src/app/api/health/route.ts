import { ANALYZER_VERSION } from "@/analysis/version";
import { jsonResponse } from "@/app/api/_lib/http";
import {
  APP_VERSION,
  isGitHubTokenConfigured,
  uptimeSeconds,
} from "@/lib/observability/runtime-info";

/**
 * GET /api/health — liveness and version information for load balancers and
 * uptime checks. Reports whether a GitHub token is configured, never its value.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthResponse {
  status: "ok";
  version: string;
  analyzerVersion: string;
  tokenConfigured: boolean;
  uptimeSeconds: number;
}

export function GET(): Response {
  const body: HealthResponse = {
    status: "ok",
    version: APP_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    tokenConfigured: isGitHubTokenConfigured(),
    uptimeSeconds: uptimeSeconds(),
  };
  return jsonResponse(body, 200);
}
