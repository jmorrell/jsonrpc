import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineConfig({
  test: {
    projects: [
      // Regular unit/integration tests (Node environment)
      {
        name: "unit",
        test: {
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["**/*.workers.test.ts"],
        },
      },

      // Workers runtime tests (workerd environment)
      defineWorkersProject({
        test: {
          name: "workers",
          include: ["src/__tests__/**/*.workers.test.ts"],
          pool: "@cloudflare/vitest-pool-workers",
          poolOptions: {
            workers: {
              main: "src/__tests__/fixtures/worker.ts",
              wrangler: {
                configPath: "src/__tests__/fixtures/wrangler.toml",
              },
            },
          },
        },
      }),
    ],
  },
});
