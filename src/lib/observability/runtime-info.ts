import packageJson from "../../../package.json";

/**
 * Facts about the running server, shared by the health endpoint and the
 * startup log line. Nothing here ever exposes a secret: token presence is
 * reported as a boolean only.
 */

/** Version of the CodeVerse application (package.json). */
export const APP_VERSION: string =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

/** Whether a GitHub token is configured for the server (never its value). */
export function isGitHubTokenConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const token = env.GITHUB_TOKEN;
  return typeof token === "string" && token.trim().length > 0;
}

/** Seconds since the server process started. */
export function uptimeSeconds(): number {
  return Math.max(0, Math.round(process.uptime()));
}
