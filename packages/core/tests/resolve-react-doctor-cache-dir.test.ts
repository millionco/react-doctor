import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveReactDoctorCacheDir } from "../src/utils/resolve-react-doctor-cache-dir.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cache-dir-"));
const originalCacheDirEnv = process.env["REACT_DOCTOR_CACHE_DIR"];

afterEach(() => {
  if (originalCacheDirEnv === undefined) delete process.env["REACT_DOCTOR_CACHE_DIR"];
  else process.env["REACT_DOCTOR_CACHE_DIR"] = originalCacheDirEnv;
});

describe("resolveReactDoctorCacheDir", () => {
  it("honors REACT_DOCTOR_CACHE_DIR (the CI override) with a per-project subdir", () => {
    const overrideRoot = path.join(tempRoot, "ci-cache-root");
    process.env["REACT_DOCTOR_CACHE_DIR"] = overrideRoot;
    const projectA = path.join(tempRoot, "project-a");
    const projectB = path.join(tempRoot, "project-b");
    const dirA = resolveReactDoctorCacheDir(projectA);
    const dirB = resolveReactDoctorCacheDir(projectB);
    // Under the override root, and per-project (a batch scan's projects must not
    // collide on one cache file).
    expect(dirA.startsWith(overrideRoot + path.sep)).toBe(true);
    expect(dirB.startsWith(overrideRoot + path.sep)).toBe(true);
    expect(dirA).not.toBe(dirB);
    // Stable for the same project.
    expect(resolveReactDoctorCacheDir(projectA)).toBe(dirA);
  });

  it("falls back to node_modules/.cache/react-doctor when no override is set", () => {
    delete process.env["REACT_DOCTOR_CACHE_DIR"];
    const projectDir = path.join(tempRoot, "with-node-modules");
    fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
    expect(resolveReactDoctorCacheDir(projectDir)).toBe(
      path.join(projectDir, "node_modules", ".cache", "react-doctor"),
    );
  });

  it("falls back to an OS-temp per-project dir when there is no node_modules or override", () => {
    delete process.env["REACT_DOCTOR_CACHE_DIR"];
    const projectDir = path.join(tempRoot, "no-node-modules");
    fs.mkdirSync(projectDir, { recursive: true });
    const resolved = resolveReactDoctorCacheDir(projectDir);
    expect(resolved.startsWith(path.join(os.tmpdir(), "react-doctor-cache"))).toBe(true);
  });
});
