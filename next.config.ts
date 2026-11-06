import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // data files are read via fs at runtime, so tell the Vercel trace to ship them
  outputFileTracingIncludes: {
    "/api/compare": ["./data/rfx.json", "./data/extracted/**/*"],
  },
  partialPrefetching: true,
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
