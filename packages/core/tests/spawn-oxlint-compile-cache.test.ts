import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../src/constants.js";
import { spawnOxlint } from "../src/runners/oxlint/spawn-oxlint.js";

// spawn-oxlint.ts captures SANITIZED_ENV from the live process.env at module
// load, so this default-case assertion only holds when the test process itself
// has neither opted out (NODE_DISABLE_COMPILE_CACHE) nor pre-set
// NODE_COMPILE_CACHE — the same two guards buildOxlintChildEnv honors. Skip
// rather than fail spuriously for a developer running with the documented
// opt-out exported; that path is covered by the pure-helper unit test.
const isCompileCacheEnvOverridden =
  Boolean(process.env.NODE_DISABLE_COMPILE_CACHE) || process.env.NODE_COMPILE_CACHE !== undefined;

describe("spawnOxlint propagates the V8 compile cache to children", () => {
  it.skipIf(isCompileCacheEnvOverridden)(
    "child sees NODE_COMPILE_CACHE set to the shared tmp base dir",
    async () => {
      const stdout = await spawnOxlint(
        ["-e", "process.stdout.write(process.env.NODE_COMPILE_CACHE ?? 'unset')"],
        process.cwd(),
        process.execPath,
        5_000,
      );
      expect(stdout).toBe(path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME));
    },
  );
});
