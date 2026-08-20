import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Some route modules (e.g. routes/teasers.ts, via @workspace/db) throw at
    // IMPORT time if DATABASE_URL isn't set -- lib/db creates a pg Pool
    // eagerly (though it only connects lazily, on first query). Tests here
    // only exercise pure, DB-free exports (e.g. classifySongSource), so a
    // placeholder connection string that's never actually dialed is enough
    // to satisfy that guard without needing a real database.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
});
