/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.D5O_OBSERVATION_CHECKPOINT === "delivery" ? { distDir: ".next-observe-delivery" } : {}),
  ...(process.env.D5O_OBSERVATION_CHECKPOINT === "support" ? { distDir: ".next-observe-support" } : {}),
  // A second loopback origin lets reviewers recover browser-local state saved
  // under the earlier 61430 URL without sharing Next's development build lock.
  ...(process.env.D5O_REVIEW_PORT === "61430" ? { distDir: ".next-review-61430" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61648" ? { distDir: ".next-review-61648" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61649" ? { distDir: ".next-review-61649" } : {}),
  // The isolated local review app is opened through 127.0.0.1, while Next's
  // development server initializes with localhost. Keep the dev exception local.
  allowedDevOrigins: ["127.0.0.1"],
  // Runtime local stores and recovery artifacts must never enter server bundles.
  outputFileTracingExcludes: {
    "/*": ["./.rybexos-local/**/*"],
  },
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
