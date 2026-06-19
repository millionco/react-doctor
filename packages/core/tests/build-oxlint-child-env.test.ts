import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../src/constants.js";
import { buildOxlintChildEnv } from "../src/utils/build-oxlint-child-env.js";

const SHARED_COMPILE_CACHE_BASE = path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME);

describe("buildOxlintChildEnv", () => {
  it("sets NODE_COMPILE_CACHE to the shared tmp base dir by default", () => {
    const childEnv = buildOxlintChildEnv({ PATH: "/usr/bin" });
    expect(childEnv.NODE_COMPILE_CACHE).toBe(SHARED_COMPILE_CACHE_BASE);
  });

  it("respects NODE_DISABLE_COMPILE_CACHE and leaves NODE_COMPILE_CACHE unset", () => {
    const childEnv = buildOxlintChildEnv({ PATH: "/usr/bin", NODE_DISABLE_COMPILE_CACHE: "1" });
    expect(childEnv.NODE_COMPILE_CACHE).toBeUndefined();
  });

  it("does not clobber an inherited NODE_COMPILE_CACHE value", () => {
    const childEnv = buildOxlintChildEnv({ PATH: "/usr/bin", NODE_COMPILE_CACHE: "/custom/dir" });
    expect(childEnv.NODE_COMPILE_CACHE).toBe("/custom/dir");
  });

  it("preserves an inherited empty-string NODE_COMPILE_CACHE (the guard is !== undefined)", () => {
    const childEnv = buildOxlintChildEnv({ PATH: "/usr/bin", NODE_COMPILE_CACHE: "" });
    expect(childEnv.NODE_COMPILE_CACHE).toBe("");
  });

  it("treats the disable and inherited guards independently", () => {
    const childEnv = buildOxlintChildEnv({
      PATH: "/usr/bin",
      NODE_DISABLE_COMPILE_CACHE: "1",
      NODE_COMPILE_CACHE: "/custom/dir",
    });
    expect(childEnv.NODE_COMPILE_CACHE).toBe("/custom/dir");
  });

  it("still strips NODE_OPTIONS, NODE_DEBUG, and npm_config_* while passing PATH through", () => {
    const childEnv = buildOxlintChildEnv({
      PATH: "/usr/bin",
      NODE_OPTIONS: "--inspect",
      NODE_DEBUG: "module",
      npm_config_foo: "bar",
    });
    expect(childEnv.NODE_OPTIONS).toBeUndefined();
    expect(childEnv.NODE_DEBUG).toBeUndefined();
    expect(childEnv.npm_config_foo).toBeUndefined();
    expect(childEnv.PATH).toBe("/usr/bin");
  });
});
