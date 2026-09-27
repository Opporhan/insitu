import type { NextConfig } from "next";

/**
 * Content Security Policy. Row data never leaves the page, and this keeps it that way even if
 * something unexpected ran in it: scripts, workers and network calls may only reach this site
 * and jsDelivr (DuckDB-WASM and OCR engines). The page cannot be framed by other sites.
 * Production only: the dev server needs eval for Fast Refresh.
 */
const CSP = [
  "default-src 'self'",
  // Next.js inline bootstrap scripts; WebAssembly (DuckDB, OCR); engine scripts from jsDelivr.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  // Files opened from a link download straight into the browser (see lib/url-import.ts).
  "connect-src 'self' https://cdn.jsdelivr.net https://docs.google.com https://*.googleusercontent.com https://raw.githubusercontent.com https://gist.githubusercontent.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Versions the offline cache per deploy (see public/sw.js).
  env: { NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now())).slice(0, 12) },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        // The service worker must always be re-checked, so a new deploy replaces it.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
