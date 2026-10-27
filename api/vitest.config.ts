import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A real local Postgres is started once for the whole run (see test/global-setup.ts).
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // The database tests share one database, so test files run one after another.
    fileParallelism: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
