/**
 * Contract for `GET /api/source/{owner}/{repo}?ref={commitSha}&path={path}`,
 * used by the lazy-loading source viewer. Shared by server and client.
 */

export interface SourceFileResponse {
  path: string;
  /** Commit SHA the content was read from. */
  ref: string;
  /** Size in bytes. */
  size: number;
  content: string;
  /** Language id from the language registry. */
  language: string;
  lines: number;
}

export type SourceErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "BINARY"
  | "TOO_LARGE"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL";

export interface SourceErrorResponse {
  error: {
    code: SourceErrorCode;
    title: string;
    message: string;
  };
}

export function sourceApiUrl(owner: string, repo: string, ref: string, path: string): string {
  const params = new URLSearchParams({ ref, path });
  return `/api/source/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${params.toString()}`;
}

export function analyzeApiUrl(owner: string, repo: string, ref?: string): string {
  const base = `/api/analyze/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return ref ? `${base}?${new URLSearchParams({ ref }).toString()}` : base;
}

/** Link to a file (optionally a line range) on the provider's website. */
export function githubBlobUrl(owner: string, repo: string, ref: string, path: string, line?: number, endLine?: number): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const anchor = line ? `#L${line}${endLine && endLine !== line ? `-L${endLine}` : ""}` : "";
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(ref)}/${encodedPath}${anchor}`;
}

export function githubTreeUrl(owner: string, repo: string, ref: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(ref)}${encodedPath ? `/${encodedPath}` : ""}`;
}
