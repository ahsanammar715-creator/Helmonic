import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Container Apps needs the self-contained server bundle. Vercel packages the
// Next.js output itself and expects the normal trace layout during onBuildComplete.
if (!process.env.VERCEL) {
  nextConfig.output = "standalone";
}

export default nextConfig;
