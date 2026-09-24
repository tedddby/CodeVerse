# Security

CodeVerse analyzes code written by strangers. Security is part of its design, not an add-on: this document
describes the threat model, the controls that address it, and how to report a vulnerability.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub's
[private vulnerability reporting](https://github.com/codeverse-oss/codeverse/security/advisories/new)
(Security tab → "Report a vulnerability"). Include:

- a description of the issue and its impact;
- steps to reproduce, ideally with a minimal repository, URL or request;
- the version or commit you tested, and your deployment setup if relevant.

What to expect:

- acknowledgement within **3 business days**;
- an initial assessment within **7 days**;
- a fix and a coordinated GitHub Security Advisory, crediting you if you wish. We aim to release fixes for
  high-severity issues within **30 days**.

Only the latest version on the default branch is supported with security fixes.

## Threat model

| Asset                            | Threats                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| The server and its network       | Server-side request forgery, resource exhaustion, code execution through repository content |
| The `GITHUB_TOKEN` and its quota | Leakage through responses, errors or logs; quota exhaustion by abusive clients              |
| Visitors' browsers               | Cross-site scripting through repository data, malicious share links, clickjacking           |
| Self-hosted disks                | Path traversal through repository paths or cache keys                                       |

Adversaries include anyone who can publish a repository (they control every path, file, name, commit message
and description CodeVerse reads), anyone who can call the public API routes, and anyone who can send a crafted
link to a visitor.

## Controls

### Repository data is untrusted

- Every GitHub API response is validated with Zod schemas before use; unexpected shapes become errors.
- Paths from tree listings and commits pass `sanitizeRepositoryPath()` before they reach the graph, a URL or a
  cache key: control characters, lone surrogates, absolute paths, empty segments and `.`/`..` segments
  (including percent-encoded forms) are rejected, and paths are limited to 1,024 characters.
- Hard limits bound every stage: tree entries (200,000), files kept, files parsed, bytes per file (with an
  absolute ceiling of 2 MB), total bytes per analysis, per-file parse timeouts and an overall time budget.
- Symbol signatures are collapsed to a single line of at most 160 characters; commit messages are reduced to
  their first line.

### Repository code is never executed

- Nothing is cloned, installed or built. Package manifests (`package.json`, `go.mod`, `Cargo.toml`, ...) are
  read as data for import resolution only.
- Parsing uses tree-sitter grammars compiled to WebAssembly and shipped with CodeVerse; WebAssembly is
  memory-safe and has no access to the file system or network. Grammar file names are validated against a
  strict pattern before they are loaded.

### SSRF boundary

- User input is parsed by `parseRepositoryInput()` into an owner and a repository name that must match
  GitHub's naming rules; anything that is not unambiguously a `github.com` repository is rejected.
- The server only ever contacts `api.github.com` and `raw.githubusercontent.com`, with URLs built from validated
  components. No user-supplied URL or host is ever fetched.
- Refs are validated, and the source viewer reads files at an exact commit SHA.

### Rendering

- All repository data is rendered as text through React's escaping. The UI never uses `dangerouslySetInnerHTML`
  with repository data and never evaluates it. Syntax highlighting produces tokens that are rendered as text.
- Links derived from repository data (GitHub file links, avatars) are built from validated parts; avatars are
  only loaded from `avatars.githubusercontent.com`.
- Share-link parameters are validated one by one; anything invalid is dropped rather than interpreted.

### Browser hardening

Every response carries security headers (see `next.config.ts`):

- `Content-Security-Policy`: `default-src 'self'`; scripts from `'self'` (plus the inline bootstrap Next.js needs
  and `'wasm-unsafe-eval'` for WebAssembly); images from `'self'`, `data:`, `blob:` and GitHub's avatar CDN;
  `connect-src 'self'`; `worker-src 'self' blob:`; `object-src 'none'`; `base-uri 'self'`;
  `form-action 'self'`; `frame-ancestors 'none'`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that disables camera,
  microphone, geolocation and payment APIs.

### Secrets

- `GITHUB_TOKEN` is read on the server only and sent only to `api.github.com` (never to the raw content host).
- It never appears in responses, error messages or client bundles. Logs redact it, along with anything that
  looks like a GitHub token. The health endpoint reports only whether a token is configured.

### Abuse and availability

- Per-client token-bucket rate limits: analyses (`CODEVERSE_RATE_LIMIT_PER_MINUTE`, default 12 per minute),
  source files (120 per minute) and repository summaries (60 per minute). Clients are identified by a keyed hash
  of their IP address.
- Concurrent requests for the same repository and commit share a single analysis; completed graphs are cached.
- Analyses have a time budget; stages stop starting new work when their share is used, and runaway runs are
  aborted.

### Caches on disk

- The optional disk cache stores one record per key under a SHA-256 file name, so keys never become paths.
  Records embed their key and expiry, are validated on read, are written atomically, and symlinks or non-regular
  files are never followed. The directory is size-bounded and pruned.

## Operator responsibilities

- **Always run behind a reverse proxy, and tell CodeVerse how many there are.** Proxies such as nginx
  (`$proxy_add_x_forwarded_for`), cloud load balancers and Vercel _append_ the client address to
  `X-Forwarded-For`, and whatever a client sends ends up at the left of that list. Rate limiting therefore reads
  the address `CODEVERSE_TRUSTED_PROXY_HOPS` entries from the right (default `1`), or a header your platform
  overwrites on every request (`CODEVERSE_CLIENT_IP_HEADER`, e.g. `x-real-ip`). Next.js only fills
  `X-Forwarded-For` when it is missing, so a server exposed directly cannot tell its clients apart.
- Give the token the least privilege possible: public repository read access only.
- Keep the deployment updated; dependency updates are automated with Dependabot and verified by CI.

## Known limitations

- The Content Security Policy allows `'unsafe-inline'` scripts, because Next.js injects inline bootstrap
  scripts and the static landing page cannot carry a per-request nonce. Every other directive is strict (no
  third-party origins, `frame-ancestors 'none'`, `object-src 'none'`), and repository data is only ever
  rendered as text. A nonce-based policy for the dynamic `/explore` routes is a planned hardening step.

## Out of scope

- The content of public repositories and GitHub's own availability or rate limits.
- Denial of service that requires volumetric traffic; put a CDN or WAF in front of public deployments.
- Findings that require a compromised host, a malicious operator or disabled security headers.
