import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // ADR-0002: the browser calls /api/notes on the web origin and the web forwards it to the API, so the API needs no
  // CORS. Exactly one path is forwarded; a new API endpoint for the browser needs its own entry here.
  async rewrites() {
    return [
      {
        source: "/api/notes",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/notes`,
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
