import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const firebaseAliases = {
  "firebase/firestore": path.resolve(__dirname, "src/lib/mockFirestore.js"),
  "firebase/storage": path.resolve(__dirname, "src/lib/mockStorage.js"),
};

const isDesktopBuild = process.env.DESKTOP_BUILD === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isDesktopBuild
    ? {
        output: "export",
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  turbopack: {
    resolveAlias: firebaseAliases,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...firebaseAliases,
    };
    return config;
  },
};

export default nextConfig;
