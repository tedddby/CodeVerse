import { z } from "zod";

/**
 * Zod schemas for the GitHub responses CodeVerse consumes. Only fields that are
 * actually used are declared; unknown keys are stripped (Zod's default), so the
 * rest of the payload never flows into the application.
 */

const optionalString = z.string().nullish();
const count = z.number().int().nonnegative();

export const repositorySchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  visibility: z.string().optional(),
  html_url: z.string(),
  description: optionalString,
  default_branch: z.string(),
  stargazers_count: count,
  forks_count: count,
  subscribers_count: count.optional(),
  watchers_count: count.optional(),
  open_issues_count: count.optional(),
  language: optionalString,
  topics: z.array(z.string()).optional(),
  license: z.object({ spdx_id: optionalString }).nullish(),
  homepage: optionalString,
  created_at: optionalString,
  pushed_at: optionalString,
  size: count.optional(),
  fork: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type GitHubRepository = z.infer<typeof repositorySchema>;

export const treeEntrySchema = z.object({
  path: z.string(),
  mode: z.string().optional(),
  type: z.string(),
  sha: z.string().optional(),
  size: count.optional(),
});
export type GitHubTreeEntry = z.infer<typeof treeEntrySchema>;

export const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean().optional(),
  tree: z.array(treeEntrySchema),
});
export type GitHubTree = z.infer<typeof treeSchema>;

const gitActorSchema = z.object({ name: optionalString, date: optionalString }).nullish();

export const commitSchema = z.object({
  sha: z.string(),
  html_url: optionalString,
  commit: z.object({
    message: z.string(),
    author: gitActorSchema,
    committer: gitActorSchema,
  }),
  author: z.object({ login: optionalString, avatar_url: optionalString }).nullish(),
});
export type GitHubCommit = z.infer<typeof commitSchema>;

export const commitListSchema = z.array(commitSchema);

export const commitDetailsSchema = commitSchema.extend({
  stats: z.object({ additions: count.optional(), deletions: count.optional() }).nullish(),
  files: z.array(z.object({ filename: z.string() })).nullish(),
});
export type GitHubCommitDetails = z.infer<typeof commitDetailsSchema>;

export const contributorSchema = z.object({
  login: optionalString,
  avatar_url: optionalString,
  contributions: count,
});
export type GitHubContributor = z.infer<typeof contributorSchema>;

/** `null` represents a 204 No Content answer (GitHub computes statistics lazily). */
export const contributorListSchema = z.array(contributorSchema).nullable();

export const graphqlEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ type: optionalString, message: optionalString })).nullish(),
});
