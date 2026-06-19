import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../src/constants.js";
import { spawnOxlint } from "../src/runners/oxlint/spawn-oxlint.js";

const TEST_OXLINT_SPAWN_TIMEOUT_MS = 5_000;

describe("spawnOxlint propagates the V8 compile cache to children", () => {
  it("child sees NODE_COMPILE_CACHE set to the shared tmp base dir", async () => {
    const previousNodeCompileCache = process.env.NODE_COMPILE_CACHE;
    const previousNodeDisableCompileCache = process.env.NODE_DISABLE_COMPILE_CACHE;
    delete process.env.NODE_COMPILE_CACHE;
    delete process.env.NODE_DISABLE_COMPILE_CACHE;

    try {
      const stdout = await spawnOxlint(
        ["-e", "process.stdout.write(process.env.NODE_COMPILE_CACHE ?? 'unset')"],
        process.cwd(),
        process.execPath,
        TEST_OXLINT_SPAWN_TIMEOUT_MS,
      );
      expect(stdout).toBe(path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME));
    } finally {
      if (previousNodeCompileCache === undefined) {
        delete process.env.NODE_COMPILE_CACHE;
      } else {
        process.env.NODE_COMPILE_CACHE = previousNodeCompileCache;
      }

      if (previousNodeDisableCompileCache === undefined) {
        delete process.env.NODE_DISABLE_COMPILE_CACHE;
      } else {
        process.env.NODE_DISABLE_COMPILE_CACHE = previousNodeDisableCompileCache;
      }
    }
  });
});
