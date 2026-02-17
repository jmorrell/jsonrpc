import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@jmorrell/jsonrpc": path.resolve(__dirname, "../../../dist/index.js"),
    },
  },
  build: {
    target: "esnext",
  },
  esbuild: {
    target: "esnext",
  },
});
