# Contributing to CodeVerse

Thanks for helping! Bug reports, docs fixes, new languages, performance work and design polish are all welcome.
Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first, and report security issues privately as described in
[SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 20.9 or newer (22 LTS recommended) and pnpm 11.

```bash
corepack enable                # provides the pnpm version pinned in package.json
pnpm install                   # also copies tree-sitter grammars into public/grammars
cp .env.example .env.local     # optional; add GITHUB_TOKEN to avoid the 60 requests/hour limit
pnpm dev                       # http://localhost:3000
```

The landing page's live demo and most of the engine work without network access: they run on the bundled demo
repository in `src/fixtures`. Exploring real repositories needs GitHub access (and ideally a token).

## Scripts

| Command           | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `pnpm dev`        | Development server with Turbopack                                         |
| `pnpm build`      | Production build                                                          |
| `pnpm start`      | Serve the production build                                                |
| `pnpm typecheck`  | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`) |
| `pnpm lint`       | ESLint (Next.js core web vitals + TypeScript rules)                       |
| `pnpm test`       | Vitest unit and component tests                                           |
| `pnpm test:watch` | Vitest in watch mode                                                      |
| `pnpm test:e2e`   | Playwright end-to-end tests (builds and starts the app on port 3100)      |
| `pnpm format`     | Prettier (with Tailwind class sorting)                                    |
| `pnpm check`      | Typecheck, lint and tests; run this before opening a pull request         |
| `pnpm grammars`   | Re-copy the tree-sitter WebAssembly binaries                              |

End-to-end tests need Chromium once: `pnpm exec playwright install chromium`. Useful variables:
`E2E_BASE_URL` (test an already running server), `E2E_PORT` (default 3100) and `SCREENSHOTS=1`
(capture visual QA screenshots into `test-results/screenshots/`).

## Code standards

- **TypeScript, strictly.** No `any` (use `unknown` and narrow), no non-null assertions unless provably safe,
  `import type` for type-only imports. Use the `@/` alias for imports from `src`.
- **Small, focused modules.** Split files that grow past roughly 300 lines. Name things for what they mean.
- **Contracts first.** Cross-module types live in a few contract files (`src/graph/model/types.ts`,
  `src/sources/types.ts`, `src/analysis/protocol.ts`, `src/engine/layout/types.ts`, `src/state/explorer-store.ts`).
  Changing one is a deliberate, reviewed decision; mention it in the pull request.
- **Repository data is untrusted.** Validate it at the boundary (Zod), render it as text, never pass it to
  `dangerouslySetInnerHTML`, `eval` or a shell, and never execute repository code.
- **Determinism.** Graph building and layout must not depend on `Math.random`, `Date.now` or unordered iteration;
  the same input must produce the same output.
- **Secrets stay on the server.** Never log or return `GITHUB_TOKEN`; use the logger in `src/lib/observability`,
  which redacts secrets.
- **UI.** Server components by default and small client islands. Use the design tokens in `globals.css`
  (`void`, `panel`, `ink`, `signal`, `ion`; `flare` is reserved for selection) and the primitives in
  `src/components/ui`. Everything must work with the keyboard, have visible focus, meet WCAG AA contrast and
  respect `prefers-reduced-motion`.
- **Formatting.** Prettier: double quotes, semicolons, trailing commas, 100 columns.

## Testing

- Put tests next to the code: `thing.ts` → `thing.test.ts`. Engine and server modules run in Node; component
  tests start with `// @vitest-environment jsdom` and use Testing Library.
- Test behavior, edge cases and invariants rather than implementation details. Parsers are tested against
  realistic snippets (including broken code); layout is tested for invariants (no overlaps, determinism).
- Use `src/fixtures` for graphs: `mockRepositoryGraph`, `buildFixtureGraph(spec)` and
  `createSyntheticGraph({ fileCount, seed })` for large, deterministic inputs.
- End-to-end tests mock the API at the browser level (`e2e/support/mock-api.ts`) so they never depend on GitHub.

## Commits and pull requests

- Keep pull requests focused; one topic per pull request is easiest to review.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(parser): extract Kotlin classes`,
  `fix(layout): keep pass-through districts inside their parent`, `docs: ...`, `test: ...`, `chore: ...`.
- Run `pnpm check` (and `pnpm test:e2e` for UI flows) before pushing. CI runs typecheck, lint, unit tests,
  a production build and the end-to-end suite.
- Include screenshots or a short recording for visual changes, and update docs when behavior changes.

## Adding a language

The short version (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#adding-a-language)):

1. Add the tree-sitter grammar and list its `.wasm` in `scripts/sync-grammars.mjs`.
2. Register the parser language in `src/lib/languages/registry.ts`.
3. Implement a `LanguageModule` in `src/parser/languages/` and register it in `src/parser/registry.ts`, with tests.
4. Add an import resolver in `src/graph/builders/dependencies/` (and any manifest it needs).
5. Map the language for syntax highlighting in `src/components/code-viewer/language-map.ts`.
6. Update the README's language table.

## Adding a source provider

Implement the `RepositorySource` interface from `src/sources/types.ts` (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#adding-a-source-provider)). The in-memory provider in
`src/sources/memory` is a compact reference. Providers must validate every response, sanitize paths, respect byte
limits, throw `SourceError` for expected failures and never leak credentials.

## Reporting bugs and requesting features

Use the issue templates. For bugs, the repository URL (if public), browser, GPU/WebGL support and the analysis
report (explorer → statistics panel) help enormously.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
