import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // ADR-0002: the browser calls /api/notes on the web origin and the web forwards it to the API, so the API needs no
  // CORS. Exactly one path is forwarded; a new API endpoint for the browser needs its own entry here.
  // An empty API_URL (a bare `API_URL=` line in .env) falls back to the local API instead of pointing back at the web,
  // and slashes at its end are dropped so the API never gets //notes.
  async rewrites() {
    const apiUrl = (process.env.API_URL || "http://localhost:3001").replace(/\/+$/, "");
    return [
      {
        source: "/api/notes",
        destination: `${apiUrl}/notes`,
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
