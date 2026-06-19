import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../src/constants.js";
import { buildOxlintChildEnv } from "../src/utils/build-oxlint-child-env.js";

const SHARED_COMPILE_CACHE_BASE = path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME);
const BASE_SOURCE_ENV: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

describe("buildOxlintChildEnv", () => {
  it("sets NODE_COMPILE_CACHE to the shared tmp base dir by default", () => {
    const childEnv = buildOxlintChildEnv(BASE_SOURCE_ENV);
    expect(childEnv.NODE_COMPILE_CACHE).toBe(SHARED_COMPILE_CACHE_BASE);
  });

  it("respects NODE_DISABLE_COMPILE_CACHE and leaves NODE_COMPILE_CACHE unset", () => {
    const childEnv = buildOxlintChildEnv({ ...BASE_SOURCE_ENV, NODE_DISABLE_COMPILE_CACHE: "1" });
    expect(childEnv.NODE_COMPILE_CACHE).toBeUndefined();
  });

  it("does not clobber an inherited NODE_COMPILE_CACHE value", () => {
    const childEnv = buildOxlintChildEnv({ ...BASE_SOURCE_ENV, NODE_COMPILE_CACHE: "/custom/dir" });
    expect(childEnv.NODE_COMPILE_CACHE).toBe("/custom/dir");
  });

  it("treats an empty NODE_COMPILE_CACHE as unset", () => {
    const childEnv = buildOxlintChildEnv({ ...BASE_SOURCE_ENV, NODE_COMPILE_CACHE: "" });
    expect(childEnv.NODE_COMPILE_CACHE).toBe(SHARED_COMPILE_CACHE_BASE);
  });

  it("removes an inherited NODE_COMPILE_CACHE when compile caching is disabled", () => {
    const childEnv = buildOxlintChildEnv({
      ...BASE_SOURCE_ENV,
      NODE_DISABLE_COMPILE_CACHE: "1",
      NODE_COMPILE_CACHE: "/custom/dir",
    });
    expect(childEnv.NODE_COMPILE_CACHE).toBeUndefined();
  });

  it("strips unsafe env while preserving ordinary string values", () => {
    const sourceEnv: NodeJS.ProcessEnv = {
      ...BASE_SOURCE_ENV,
      HOME: "/home/user",
      NODE_ENV: "test",
      NODE_PATH: "/workspace/node_modules",
      NODE_OPTIONS: "--inspect",
      NODE_DEBUG: "module",
      REACT_DOCTOR_CUSTOM_ENV: "1",
      UNDEFINED_ENV: undefined,
      npm_config_foo: "bar",
    };
    const childEnv = buildOxlintChildEnv(sourceEnv);
    expect(childEnv.NODE_OPTIONS).toBeUndefined();
    expect(childEnv.NODE_DEBUG).toBeUndefined();
    expect(childEnv.npm_config_foo).toBeUndefined();
    expect(childEnv.PATH).toBe("/usr/bin");
    expect(childEnv.HOME).toBe("/home/user");
    expect(childEnv.NODE_ENV).toBe("test");
    expect(childEnv.NODE_PATH).toBe("/workspace/node_modules");
    expect(childEnv.REACT_DOCTOR_CUSTOM_ENV).toBe("1");
    expect("UNDEFINED_ENV" in childEnv).toBe(false);
    expect(sourceEnv.NODE_OPTIONS).toBe("--inspect");
  });
});
