## What and why

<!-- What does this change, and why? Link the issue it resolves, e.g. "Closes #123". -->

## How it was tested

<!-- Tests added or updated, manual checks, repositories you explored. -->

## Screenshots

<!-- For visual changes: before/after screenshots or a short recording. Delete if not applicable. -->

## Checklist

- [ ] `pnpm check` passes (typecheck, lint, unit tests)
- [ ] End-to-end tests pass for UI flows (`pnpm test:e2e`), or this change does not affect them
- [ ] Repository data stays untrusted: validated at the boundary, rendered as text, never executed
- [ ] Keyboard access, visible focus, contrast and reduced motion checked for UI changes
- [ ] Docs updated (README, `docs/`) if behavior, configuration or contracts changed
- [ ] Contract files (`src/graph/model/types.ts`, `src/sources/types.ts`, `src/analysis/protocol.ts`, `src/engine/layout/types.ts`, `src/state/explorer-store.ts`) changed deliberately, and explained above
