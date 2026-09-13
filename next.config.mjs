/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared workspace packages from source (raw .ts, no dist).
  transpilePackages: ["@bcn-services/ui", "@bcn-services/app-core"],
  // Self-contained server bundle — CI ships .next/standalone as the deploy artifact.
  output: "standalone",
};

export default nextConfig;
