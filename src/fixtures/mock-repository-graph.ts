/**
 * `mockRepositoryGraph` — a small, realistic fixture repository.
 *
 * Used by engine/unit tests, the landing page's interactive demo world and
 * local development without GitHub. It is never presented as real data: the
 * repository is clearly labelled "codeverse-demo/acme-platform".
 */
import { buildFixtureGraph, type FixtureSpec } from "./fixture-builder";

export const MOCK_REPOSITORY_SPEC: FixtureSpec = {
  owner: "codeverse-demo",
  name: "acme-platform",
  description: "Demo repository used to preview CodeVerse without contacting GitHub.",
  stars: 1284,
  forks: 212,
  referenceDate: "2026-09-01T00:00:00.000Z",
  contributors: [
    { login: "octo-ada", name: "Ada Octo", contributions: 412 },
    { login: "octo-bruno", name: "Bruno Octo", contributions: 238 },
    { login: "octo-chen", name: "Chen Octo", contributions: 131 },
    { login: "octo-dara", name: "Dara Octo", contributions: 57 },
  ],
  files: [
    // Root
    { path: "README.md", lines: 184 },
    { path: "package.json", lines: 58 },
    { path: "tsconfig.json", lines: 31 },
    { path: ".gitignore", lines: 24 },
    { path: "pnpm-lock.yaml", lines: 6400, size: 240_000 },
    // src
    {
      path: "src/index.ts",
      lines: 96,
      imports: [
        "src/auth/middleware.ts",
        "src/payments/checkout.ts",
        "src/users/service.ts",
        "src/lib/config.ts",
        "src/api/routes.ts",
      ],
      symbols: [
        { kind: "function", name: "createServer", start: 12, end: 70, exported: true },
        { kind: "function", name: "main", start: 74, end: 96 },
      ],
    },
    {
      path: "src/auth/auth.ts",
      lines: 842,
      imports: ["src/auth/jwt.ts", "src/users/user.ts", "src/lib/logger.ts", "src/auth/session.ts"],
      symbols: [
        { kind: "interface", name: "AuthOptions", start: 8, end: 24, exported: true },
        { kind: "class", name: "AuthService", start: 30, end: 610, exported: true },
        { kind: "method", name: "authenticate", start: 44, end: 120, parent: "AuthService" },
        { kind: "method", name: "refresh", start: 124, end: 190, parent: "AuthService" },
        { kind: "method", name: "revoke", start: 194, end: 260, parent: "AuthService" },
        { kind: "method", name: "verifyPassword", start: 264, end: 330, parent: "AuthService" },
        { kind: "function", name: "hashPassword", start: 620, end: 700, exported: true },
        { kind: "function", name: "authenticate", start: 704, end: 842, exported: true },
      ],
    },
    {
      path: "src/auth/jwt.ts",
      lines: 318,
      imports: ["src/users/user.ts", "pkg:jsonwebtoken", "src/lib/config.ts"],
      symbols: [
        { kind: "type", name: "TokenClaims", start: 5, end: 18, exported: true },
        { kind: "function", name: "signToken", start: 22, end: 120, exported: true },
        { kind: "function", name: "verifyToken", start: 124, end: 250, exported: true },
        { kind: "constant", name: "TOKEN_TTL", start: 3, end: 3, exported: true },
      ],
    },
    {
      path: "src/auth/middleware.ts",
      lines: 164,
      imports: ["src/auth/auth.ts", "src/auth/session.ts", "pkg:express"],
      symbols: [
        { kind: "function", name: "requireAuth", start: 10, end: 80, exported: true },
        { kind: "function", name: "optionalAuth", start: 84, end: 164, exported: true },
      ],
    },
    {
      path: "src/auth/session.ts",
      lines: 226,
      imports: ["src/lib/db.ts"],
      symbols: [
        { kind: "class", name: "SessionStore", start: 12, end: 220, exported: true },
        { kind: "method", name: "create", start: 20, end: 80, parent: "SessionStore" },
        { kind: "method", name: "destroy", start: 84, end: 130, parent: "SessionStore" },
      ],
    },
    {
      path: "src/payments/stripe.ts",
      lines: 512,
      imports: ["pkg:stripe", "src/lib/logger.ts", "src/payments/types.ts", "src/lib/config.ts"],
      symbols: [
        { kind: "class", name: "StripeGateway", start: 14, end: 480, exported: true },
        { kind: "method", name: "charge", start: 30, end: 160, parent: "StripeGateway" },
        { kind: "method", name: "refund", start: 164, end: 260, parent: "StripeGateway" },
        { kind: "method", name: "handleWebhook", start: 264, end: 470, parent: "StripeGateway" },
      ],
    },
    {
      path: "src/payments/checkout.ts",
      lines: 388,
      imports: [
        "src/payments/stripe.ts",
        "src/users/service.ts",
        "src/payments/types.ts",
        "src/payments/pricing.ts",
      ],
      symbols: [
        { kind: "function", name: "createCheckoutSession", start: 20, end: 200, exported: true },
        { kind: "function", name: "completeCheckout", start: 204, end: 388, exported: true },
      ],
    },
    {
      path: "src/payments/pricing.ts",
      lines: 142,
      imports: ["src/payments/types.ts"],
      symbols: [{ kind: "function", name: "calculateTotal", start: 8, end: 142, exported: true }],
    },
    {
      path: "src/payments/types.ts",
      lines: 88,
      symbols: [
        { kind: "interface", name: "Invoice", start: 1, end: 30, exported: true },
        { kind: "interface", name: "LineItem", start: 32, end: 50, exported: true },
        { kind: "enum", name: "Currency", start: 52, end: 88, exported: true },
      ],
    },
    {
      path: "src/users/user.ts",
      lines: 120,
      symbols: [
        { kind: "interface", name: "User", start: 1, end: 40, exported: true },
        { kind: "function", name: "displayName", start: 44, end: 60, exported: true },
      ],
    },
    {
      path: "src/users/service.ts",
      lines: 402,
      imports: ["src/users/user.ts", "src/users/repository.ts", "src/lib/logger.ts"],
      symbols: [
        { kind: "class", name: "UserService", start: 10, end: 400, exported: true },
        { kind: "method", name: "findById", start: 20, end: 60, parent: "UserService" },
        { kind: "method", name: "register", start: 64, end: 200, parent: "UserService" },
      ],
    },
    {
      path: "src/users/repository.ts",
      lines: 276,
      imports: ["src/lib/db.ts", "src/users/user.ts"],
      symbols: [{ kind: "class", name: "UserRepository", start: 8, end: 276, exported: true }],
    },
    {
      path: "src/lib/logger.ts",
      lines: 74,
      imports: ["pkg:pino"],
      symbols: [{ kind: "function", name: "createLogger", start: 4, end: 74, exported: true }],
    },
    {
      path: "src/lib/db.ts",
      lines: 190,
      imports: ["pkg:pg", "src/lib/config.ts"],
      symbols: [
        { kind: "function", name: "connect", start: 10, end: 90, exported: true },
        { kind: "function", name: "transaction", start: 94, end: 190, exported: true },
      ],
    },
    {
      path: "src/lib/config.ts",
      lines: 66,
      imports: ["pkg:zod"],
      symbols: [{ kind: "constant", name: "config", start: 20, end: 66, exported: true }],
    },
    {
      path: "src/api/routes.ts",
      lines: 158,
      imports: ["src/api/handlers/auth.ts", "src/api/handlers/payments.ts", "pkg:express"],
      symbols: [{ kind: "function", name: "registerRoutes", start: 6, end: 158, exported: true }],
    },
    {
      path: "src/api/handlers/auth.ts",
      lines: 212,
      imports: ["src/auth/auth.ts", "src/auth/jwt.ts"],
      symbols: [
        { kind: "function", name: "login", start: 8, end: 100, exported: true },
        { kind: "function", name: "logout", start: 104, end: 212, exported: true },
      ],
    },
    {
      path: "src/api/handlers/payments.ts",
      lines: 244,
      imports: ["src/payments/checkout.ts", "src/auth/middleware.ts"],
      symbols: [{ kind: "function", name: "checkoutHandler", start: 10, end: 244, exported: true }],
    },
    // tests
    {
      path: "tests/auth.test.ts",
      lines: 390,
      imports: ["src/auth/auth.ts", "src/auth/jwt.ts", "pkg:vitest"],
    },
    {
      path: "tests/payments.test.ts",
      lines: 280,
      imports: ["src/payments/checkout.ts", "pkg:vitest"],
    },
    { path: "tests/users.test.ts", lines: 166, imports: ["src/users/service.ts", "pkg:vitest"] },
    // docs
    { path: "docs/architecture.md", lines: 240 },
    { path: "docs/getting-started.md", lines: 132 },
    { path: "docs/diagrams/overview.png", lines: 0, size: 184_000 },
    // packages
    {
      path: "packages/sdk/src/index.ts",
      lines: 48,
      imports: ["packages/sdk/src/client.ts"],
      symbols: [{ kind: "function", name: "createClient", start: 4, end: 48, exported: true }],
    },
    {
      path: "packages/sdk/src/client.ts",
      lines: 356,
      imports: ["pkg:undici"],
      symbols: [
        { kind: "class", name: "AcmeClient", start: 12, end: 350, exported: true },
        { kind: "method", name: "request", start: 30, end: 120, parent: "AcmeClient" },
      ],
    },
    { path: "packages/sdk/package.json", lines: 36 },
    {
      path: "packages/cli/acme_cli/main.py",
      lines: 214,
      imports: ["packages/cli/acme_cli/commands.py", "pkg:click"],
      symbols: [{ kind: "function", name: "main", start: 180, end: 214, exported: true }],
    },
    {
      path: "packages/cli/acme_cli/commands.py",
      lines: 330,
      imports: ["pkg:requests"],
      symbols: [
        { kind: "class", name: "DeployCommand", start: 10, end: 160, exported: true },
        { kind: "function", name: "status", start: 164, end: 330, exported: true },
      ],
    },
    // services (Go, Rust, Java)
    {
      path: "services/billing/main.go",
      lines: 142,
      imports: ["services/billing/invoice.go", "pkg:net/http"],
      symbols: [{ kind: "function", name: "main", start: 20, end: 142, exported: false }],
    },
    {
      path: "services/billing/invoice.go",
      lines: 268,
      symbols: [
        { kind: "struct", name: "Invoice", start: 8, end: 30, exported: true },
        { kind: "function", name: "Render", start: 34, end: 268, exported: true },
      ],
    },
    {
      path: "services/hasher/src/lib.rs",
      lines: 190,
      imports: ["pkg:sha2"],
      symbols: [
        { kind: "trait", name: "Hasher", start: 5, end: 20, exported: true },
        { kind: "function", name: "digest", start: 24, end: 190, exported: true },
      ],
    },
    {
      path: "services/reports/src/main/java/com/acme/reports/ReportJob.java",
      lines: 244,
      imports: ["pkg:java.util"],
      symbols: [
        { kind: "class", name: "ReportJob", start: 10, end: 244, exported: true },
        { kind: "method", name: "run", start: 30, end: 200, parent: "ReportJob" },
      ],
    },
    // scripts & assets
    { path: "scripts/deploy.sh", lines: 88 },
    { path: "public/logo.svg", lines: 12 },
    { path: "public/styles.css", lines: 420 },
  ],
  commits: [
    {
      sha: "a1",
      message: "Harden JWT verification",
      author: "octo-ada",
      daysAgo: 2,
      files: ["src/auth/jwt.ts", "tests/auth.test.ts"],
    },
    {
      sha: "a2",
      message: "Add refund webhooks",
      author: "octo-bruno",
      daysAgo: 4,
      files: ["src/payments/stripe.ts", "src/payments/types.ts"],
    },
    {
      sha: "a3",
      message: "Session store uses transactions",
      author: "octo-ada",
      daysAgo: 9,
      files: ["src/auth/session.ts", "src/lib/db.ts"],
    },
    {
      sha: "a4",
      message: "CLI deploy status command",
      author: "octo-chen",
      daysAgo: 12,
      files: ["packages/cli/acme_cli/commands.py", "packages/cli/acme_cli/main.py"],
    },
    {
      sha: "a5",
      message: "Checkout pricing rules",
      author: "octo-bruno",
      daysAgo: 16,
      files: ["src/payments/pricing.ts", "src/payments/checkout.ts", "tests/payments.test.ts"],
    },
    {
      sha: "a6",
      message: "Billing invoice renderer",
      author: "octo-dara",
      daysAgo: 24,
      files: ["services/billing/invoice.go", "services/billing/main.go"],
    },
    {
      sha: "a7",
      message: "Route handlers for auth",
      author: "octo-ada",
      daysAgo: 31,
      files: ["src/api/handlers/auth.ts", "src/api/routes.ts"],
    },
    {
      sha: "a8",
      message: "User registration flow",
      author: "octo-chen",
      daysAgo: 38,
      files: ["src/users/service.ts", "src/users/repository.ts", "tests/users.test.ts"],
    },
    {
      sha: "a9",
      message: "SDK client retries",
      author: "octo-bruno",
      daysAgo: 45,
      files: ["packages/sdk/src/client.ts"],
    },
    {
      sha: "b1",
      message: "Architecture docs",
      author: "octo-dara",
      daysAgo: 60,
      files: ["docs/architecture.md", "README.md"],
    },
    {
      sha: "b2",
      message: "Structured logging",
      author: "octo-ada",
      daysAgo: 74,
      files: ["src/lib/logger.ts", "src/index.ts"],
    },
    {
      sha: "b3",
      message: "Hasher crate",
      author: "octo-chen",
      daysAgo: 90,
      files: ["services/hasher/src/lib.rs"],
    },
    {
      sha: "b4",
      message: "Report job scheduling",
      author: "octo-dara",
      daysAgo: 110,
      files: ["services/reports/src/main/java/com/acme/reports/ReportJob.java"],
    },
    {
      sha: "b5",
      message: "Config validation with zod",
      author: "octo-ada",
      daysAgo: 130,
      files: ["src/lib/config.ts", "package.json"],
    },
    {
      sha: "b6",
      message: "Initial payments module",
      author: "octo-bruno",
      daysAgo: 160,
      files: ["src/payments/stripe.ts", "src/payments/checkout.ts", "src/payments/types.ts"],
    },
    {
      sha: "b7",
      message: "Initial auth module",
      author: "octo-ada",
      daysAgo: 200,
      files: ["src/auth/auth.ts", "src/auth/jwt.ts", "src/auth/middleware.ts"],
    },
  ],
};

export const mockRepositoryGraph = buildFixtureGraph(MOCK_REPOSITORY_SPEC);
