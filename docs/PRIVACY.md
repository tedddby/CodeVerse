# Privacy

CodeVerse is built to need as little data as possible. It has no accounts, no analytics, no advertising and
no tracking. This page describes exactly what a CodeVerse server processes, what it keeps and for how long.
It applies to the open-source software; if you use someone else's deployment, its operator may add their own
policies (hosting logs, for example).

## What is processed

When you explore a repository, the server reads **public** data from GitHub on your behalf:

- repository metadata (name, description, topics, license, stars, default branch, the commit being analyzed);
- the file tree (paths and sizes);
- the contents of files selected for analysis, within the configured byte limits;
- recent commits (SHA, first line of the message, author name and login, date, changed files) and contributors
  (login, display name, avatar URL, contribution count).

File contents are parsed in memory to extract structure and are discarded as soon as the file has been parsed.
They are never written to disk or to the graph cache.

When you open a file in the source viewer, the server fetches that single file from GitHub at the analyzed commit
and returns it to your browser. It is not stored on the server.

## What is cached

The result of an analysis is a `RepositoryGraph` ([model](../src/graph/model/types.ts)), cached so the next
visitor of the same commit gets it instantly. The cache key is the repository and exact commit SHA
(`{analyzerVersion}:{repository}@{commitSha}:{settingsHash}`).

A cached graph contains:

- paths, sizes, languages, line counts and analysis status of files;
- symbol names, kinds, line ranges and one-line declaration signatures (at most 160 characters);
- import specifiers and the resolved dependency edges;
- the commit and contributor metadata listed above, and the repository metadata.

A cached graph never contains file contents.

| Where                                      | How long                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Server memory                              | Up to 6 hours, evicted earlier under memory pressure (`CODEVERSE_CACHE_MAX_MB`) |
| Disk, only if `CODEVERSE_CACHE_DIR` is set | Up to 7 days, pruned by age and total size                                      |

Separately, the GitHub client keeps a small in-memory cache of repository metadata and commit-list responses to
revalidate them with ETags (this saves API quota). It never holds file contents and is lost on restart.

## What is not collected

- No cookies, no analytics or telemetry, no third-party scripts.
- No accounts and no personal data beyond what the public GitHub API returns about commits and contributors.
- Server logs are structured and redact secrets. They record operational events (the repository analyzed, timings,
  errors). For per-client rate limiting, the client IP address is reduced in memory to a keyed hash with a
  per-process secret; the raw address is neither stored nor logged by CodeVerse. Your hosting provider or
  reverse proxy may keep its own access logs.

## In your browser

- The explorer keeps the graph and any source files you open in memory for the duration of the visit.
- `localStorage` stores a single flag that remembers you have seen the first-visit navigation hint.
- Contributor avatars are loaded directly from `avatars.githubusercontent.com`, so GitHub sees those image requests.
- In-world labels are drawn with a web font. Operators can self-host it with `NEXT_PUBLIC_LABEL_FONT_URL`; otherwise
  the label renderer's default font resolver may request font files from a public CDN.

## GitHub token

`GITHUB_TOKEN` is read from the server environment only. It is sent exclusively to GitHub's API, is never included
in responses, errors or client code, and is redacted from logs. The health endpoint reports only whether a token is
configured, never its value.

## Contact

Privacy questions or concerns about the software can be raised as a GitHub issue. For anything sensitive, follow
the private reporting process in [SECURITY.md](../SECURITY.md).
