import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 * - No third-party scripts are loaded; repository data is only ever rendered as text.
 * - `wasm-unsafe-eval` allows WebAssembly (tree-sitter) in browser workers.
 * - Avatars are the only remote images and come from GitHub's avatar CDN.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-hosting (Docker) sets NEXT_OUTPUT=standalone; Vercel and `next start` use the default.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // web-tree-sitter ships Emscripten glue that must be required natively on the server.
  serverExternalPackages: ["web-tree-sitter"],
  // The parser reads grammar binaries from disk at runtime; make sure they are traced.
  outputFileTracingIncludes: {
    "/api/**/*": ["./public/grammars/*.wasm"],
    // Social cards read Geist from disk (standalone/Docker builds must include it).
    "/opengraph-image": ["./node_modules/geist/dist/fonts/geist-sans/*.ttf", "./node_modules/geist/dist/fonts/geist-mono/*.ttf"],
    "/explore/**/*": ["./node_modules/geist/dist/fonts/geist-sans/*.ttf", "./node_modules/geist/dist/fonts/geist-mono/*.ttf"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
