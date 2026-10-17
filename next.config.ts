import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / WASM server-only packages must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "postgres"],
  // Local PGlite databases migrate on first use, so the SQL must ship with the server.
  outputFileTracingIncludes: { "/**": ["./supabase/migrations/*.sql"] },
  experimental: {
    // A dev cache restored across restarts left browsers in an endless
    // "HMR hash mismatch" reload loop (Next 16.4 + Turbopack); start clean instead.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;
