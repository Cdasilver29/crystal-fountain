import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure functions in src/server.
 *
 * Deliberately narrow. The verify-part-*.ts suites cover anything that needs a
 * database, an HTTP server or a real campaign in it, and they stay where they
 * are: those prove behaviour against Postgres, which a unit runner cannot. This
 * runner is for functions that take a value and return a value, where the whole
 * point is the long tail of inputs. src/server/display-name.ts is the first of
 * them, and the congregation's real display names are exactly such a tail.
 *
 * The alias is spelled out rather than read from tsconfig through a plugin, so
 * this config needs no dependency beyond vitest itself.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
