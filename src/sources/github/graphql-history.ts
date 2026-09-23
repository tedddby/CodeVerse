import { z } from "zod";
import type { GitHubClient } from "@/github/client";
import { chunk, mapWithConcurrency, throwIfAborted } from "@/github/async";
import { sanitizeRepositoryPath } from "@/github/paths";
import { cleanSingleLine, normalizeIsoDate } from "@/github/text";
import {
  isSourceError,
  SourceError,
  type SourceCommitCountBucket,
  type SourceFileActivity,
} from "@/sources/types";
import { validLogin } from "./history";
import type { RepositoryCoordinates } from "./snapshot";

/**
 * GraphQL-backed history lookups (token required).
 *
 * Security: repository paths and dates are passed exclusively as GraphQL
 * variables (`$p0`, `$s0`, ...). The query text only ever contains aliases and
 * variable names derived from indices, so no repository data can alter the
 * query (no GraphQL injection).
 */

export const FILE_ACTIVITY_BATCH_SIZE = 40;
export const COMMIT_COUNT_BATCH_SIZE = 50;
const FILE_ACTIVITY_CONCURRENCY = 2;

const historyConnectionSchema = z.object({
  nodes: z
    .array(
      z
        .object({
          committedDate: z.string(),
          author: z
            .object({
              name: z.string().nullish(),
              user: z.object({ login: z.string().nullish() }).nullish(),
            })
            .nullish(),
        })
        .nullable(),
    )
    .nullish(),
});

const countConnectionSchema = z.object({ totalCount: z.number().int().nonnegative() });

/** `repository.object` holds one aliased connection per requested item. */
const aliasedObjectSchema = z.object({
  repository: z.object({ object: z.record(z.string(), z.unknown()).nullish() }).nullish(),
});

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** Builds the per-file last-commit query for `count` paths ($p0..$p{count-1}). */
export function buildFileActivityQuery(count: number): string {
  const variables = range(count).map((index) => `$p${index}:String!`);
  const fields = range(count).map(
    (index) =>
      `f${index}:history(first:1,path:$p${index}){nodes{committedDate author{name user{login}}}}`,
  );
  return (
    `query CodeVerseFileActivity($owner:String!,$name:String!,$oid:GitObjectID!,${variables.join(",")})` +
    `{repository(owner:$owner,name:$name){object(oid:$oid){...on Commit{${fields.join(" ")}}}}}`
  );
}

/** Builds the commit-count query for `count` ranges ($s0/$u0 ...). */
export function buildCommitCountQuery(count: number): string {
  const variables = range(count).flatMap((index) => [
    `$s${index}:GitTimestamp!`,
    `$u${index}:GitTimestamp!`,
  ]);
  const fields = range(count).map(
    (index) => `c${index}:history(since:$s${index},until:$u${index}){totalCount}`,
  );
  return (
    `query CodeVerseCommitCounts($owner:String!,$name:String!,$oid:GitObjectID!,${variables.join(",")})` +
    `{repository(owner:$owner,name:$name){object(oid:$oid){...on Commit{${fields.join(" ")}}}}}`
  );
}

function baseVariables(coordinates: RepositoryCoordinates): Record<string, unknown> {
  return { owner: coordinates.owner, name: coordinates.repo, oid: coordinates.sha };
}

async function runAliasedQuery(
  client: GitHubClient,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const data = await client.graphql(query, variables, aliasedObjectSchema, signal);
  const object = data.repository?.object;
  if (!object) {
    throw new SourceError("NOT_FOUND", "GitHub could not find the snapshot commit.", {
      status: 200,
    });
  }
  return object;
}

function mapActivity(value: unknown): SourceFileActivity | undefined {
  const parsed = historyConnectionSchema.safeParse(value);
  const node = parsed.success ? parsed.data.nodes?.[0] : undefined;
  const lastModified = normalizeIsoDate(node?.committedDate);
  if (!node || !lastModified) return undefined;
  const activity: SourceFileActivity = { lastModified };
  const login = validLogin(node.author?.user?.login);
  if (login) activity.authorLogin = login;
  const name = node.author?.name ? cleanSingleLine(node.author.name, 200) : "";
  if (name) activity.authorName = name;
  return activity;
}

function isFatalForFirstBatch(error: unknown): boolean {
  return isSourceError(error) && (error.code === "RATE_LIMITED" || error.code === "UNAUTHORIZED");
}

/**
 * Last commit per path at the snapshot commit. Paths without history are
 * omitted. A failing batch is skipped (its paths are simply unknown); only a
 * rate-limit/authorization failure of the first batch is reported, since it
 * means the lookup cannot work at all. After any rate-limit failure the
 * remaining batches are not sent.
 */
export async function getFileActivity(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  paths: readonly string[],
  maxPathLength: number,
  signal?: AbortSignal,
): Promise<Map<string, SourceFileActivity>> {
  throwIfAborted(signal);
  const unique = [...new Set(paths)].filter(
    (path) => sanitizeRepositoryPath(path, maxPathLength) !== null,
  );
  const batches = chunk(unique, FILE_ACTIVITY_BATCH_SIZE);
  const activity = new Map<string, SourceFileActivity>();
  // Cancels batches still in flight once the lookup is known to be futile.
  const internal = new AbortController();
  const batchSignal = signal ? AbortSignal.any([signal, internal.signal]) : internal.signal;
  let halted = false;

  await mapWithConcurrency(batches, FILE_ACTIVITY_CONCURRENCY, async (batch, batchIndex) => {
    if (halted) return;
    const variables = baseVariables(coordinates);
    batch.forEach((path, index) => {
      variables[`p${index}`] = path;
    });
    let object: Record<string, unknown>;
    try {
      object = await runAliasedQuery(
        client,
        buildFileActivityQuery(batch.length),
        variables,
        batchSignal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!isFatalForFirstBatch(error)) return;
      halted = true;
      if (batchIndex === 0) {
        internal.abort();
        throw error;
      }
      return;
    }
    batch.forEach((path, index) => {
      const entry = mapActivity(object[`f${index}`]);
      if (entry) activity.set(path, entry);
    });
  });
  throwIfAborted(signal);
  return activity;
}

/** Normalizes a range to [since, until] timestamps with an exclusive end (second precision). */
function toTimestamps(range: {
  start: string;
  end: string;
}): { since: string; until: string } | undefined {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;
  // Git timestamps have second precision; stop one second before `end` so that
  // adjacent buckets never count a commit twice.
  const until = Math.max(start, end - 1_000);
  return { since: new Date(start).toISOString(), until: new Date(until).toISOString() };
}

/**
 * Exact commit counts per range, reachable from the snapshot commit, in input
 * order. All-or-nothing: a partially counted timeline would be misleading, so
 * any failing batch fails the call and the pipeline falls back to sampling.
 */
export async function getCommitCounts(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  ranges: ReadonlyArray<{ start: string; end: string }>,
  signal?: AbortSignal,
): Promise<SourceCommitCountBucket[]> {
  throwIfAborted(signal);
  const buckets: SourceCommitCountBucket[] = ranges.map((item) => ({
    start: item.start,
    end: item.end,
    commits: 0,
  }));
  const queryable = ranges
    .map((item, index) => ({ index, timestamps: toTimestamps(item) }))
    .filter(
      (item): item is { index: number; timestamps: { since: string; until: string } } =>
        item.timestamps !== undefined,
    );

  for (const batch of chunk(queryable, COMMIT_COUNT_BATCH_SIZE)) {
    const variables = baseVariables(coordinates);
    batch.forEach((item, position) => {
      variables[`s${position}`] = item.timestamps.since;
      variables[`u${position}`] = item.timestamps.until;
    });
    const object = await runAliasedQuery(
      client,
      buildCommitCountQuery(batch.length),
      variables,
      signal,
    );
    batch.forEach((item, position) => {
      const parsed = countConnectionSchema.safeParse(object[`c${position}`]);
      const bucket = buckets[item.index];
      if (!parsed.success || !bucket) {
        throw new SourceError("INVALID_RESPONSE", "GitHub returned an incomplete commit count.", {
          status: 200,
        });
      }
      bucket.commits = parsed.data.totalCount;
    });
  }
  return buckets;
}
