import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mssql"],
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "*": ["./.data/**/*", "./.env*", "./research/**/*"],
  },
};
export default config;
