import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";
import { defineProject } from "vitest/config";

export default [
  // Regular unit/integration tests (Node environment)
  defineProject({
    test: {
      name: "unit",
      include: ["src/__tests__/**/*.test.ts"],
      exclude: ["**/*.workers.test.ts"],
    },
  }),

  // Workers runtime tests (workerd environment)
  defineWorkersProject({
    test: {
      name: "workers",
      include: ["src/__tests__/**/*.workers.test.ts"],
    },
  }),
];
