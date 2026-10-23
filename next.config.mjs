/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.D5O_OBSERVATION_CHECKPOINT === "delivery" ? { distDir: ".next-observe-delivery" } : {}),
  ...(process.env.D5O_OBSERVATION_CHECKPOINT === "support" ? { distDir: ".next-observe-support" } : {}),
  // A second loopback origin lets reviewers recover browser-local state saved
  // under the earlier 61430 URL without sharing Next's development build lock.
  ...(process.env.D5O_REVIEW_PORT === "61430" ? { distDir: ".next-review-61430" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61643" ? { distDir: ".next-review-61643" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61648" ? { distDir: ".next-review-61648" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61649" ? { distDir: ".next-review-61649" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61650" ? { distDir: ".next-review-61650" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61657" ? { distDir: ".next-review-61657" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61659" ? { distDir: ".next-review-61659" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61660" ? { distDir: ".next-review-61660" } : {}),
  ...(process.env.D5O_REVIEW_PORT === "61661" ? { distDir: ".next-review-61661" } : {}),
  // The isolated local review app is opened through 127.0.0.1, while Next's
  // development server initializes with localhost. Keep the dev exception local.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep document parsers in the Node runtime; Turbopack worker bundling cannot resolve PDF font helpers.
  serverExternalPackages: ["pdfjs-dist", "exceljs"],
  // Runtime local stores and recovery artifacts must never enter server bundles.
  outputFileTracingExcludes: {
    "/*": ["./.rybexos-local/**/*"],
  },
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
