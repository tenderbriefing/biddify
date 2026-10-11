import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 1: always-fresh operational UI over local DB.
  // Cache Components can be adopted later once read models are stable.
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
