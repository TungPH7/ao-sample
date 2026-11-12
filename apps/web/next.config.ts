import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The image of apps/web/Dockerfile runs .next/standalone: the server and only the modules it uses.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // ADR-0002: the browser calls /api/notes on the web origin and the web forwards it to the API, so the API needs no
  // CORS. Exactly two paths are forwarded, /api/notes and /api/notes/:id/pin (ADR-0004); a new API endpoint for the
  // browser needs its own entry here. :id matches one segment only, never :path*, and the target always ends with
  // /pin, so the pin entry opens no other path of the API (plan of SMP-23, decision 5).
  // An empty API_URL (a bare `API_URL=` line in .env) falls back to the local API instead of pointing back at the web,
  // and slashes at its end are dropped so the API never gets //notes.
  async rewrites() {
    const apiUrl = (process.env.API_URL || "http://localhost:3001").replace(/\/+$/, "");
    return [
      {
        source: "/api/notes",
        destination: `${apiUrl}/notes`,
      },
      {
        source: "/api/notes/:id/pin",
        destination: `${apiUrl}/notes/:id/pin`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
