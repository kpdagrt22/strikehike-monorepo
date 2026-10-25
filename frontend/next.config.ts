import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root to this project (multiple lockfiles exist on disk).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
