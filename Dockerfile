# syntax=docker/dockerfile:1

# CodeVerse production image: the Next.js standalone server on Node.js 22 (Alpine).
#
#   docker build -t codeverse .
#   docker run -p 3000:3000 -e GITHUB_TOKEN=... codeverse
#
# NEXT_PUBLIC_* values are inlined at build time; override them with --build-arg.

ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=11.21.0

# ── Base: Node.js + pnpm through corepack ───────────────────────────────────
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# A current corepack knows the signing keys of recent pnpm releases.
RUN npm install --global corepack@latest \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
# Some prebuilt native binaries expect glibc symbols.
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The postinstall script copies the tree-sitter grammars into public/grammars.
COPY scripts ./scripts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ── Build ───────────────────────────────────────────────────────────────────
FROM base AS builder
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_REPOSITORY_URL=https://github.com/codeverse-oss/codeverse
ARG NEXT_PUBLIC_LABEL_FONT_URL=
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_REPOSITORY_URL=${NEXT_PUBLIC_REPOSITORY_URL} \
    NEXT_PUBLIC_LABEL_FONT_URL=${NEXT_PUBLIC_LABEL_FONT_URL} \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/public/grammars ./public/grammars
COPY . .
RUN pnpm build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 codeverse \
    && adduser --system --uid 1001 --ingroup codeverse codeverse \
    && mkdir -p /app/.codeverse-cache \
    && chown codeverse:codeverse /app/.codeverse-cache

# Standalone server, static assets and public files (including public/grammars,
# which the server-side parser reads at runtime).
COPY --from=builder --chown=codeverse:codeverse /app/.next/standalone ./
COPY --from=builder --chown=codeverse:codeverse /app/.next/static ./.next/static
COPY --from=builder --chown=codeverse:codeverse /app/public ./public

USER codeverse
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
