import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveReactDoctorCacheDir } from "../src/utils/resolve-react-doctor-cache-dir.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cache-dir-"));
const originalCacheDirEnv = process.env["REACT_DOCTOR_CACHE_DIR"];
const originalCachePartitionEnv = process.env["REACT_DOCTOR_CACHE_PARTITION"];

afterEach(() => {
  if (originalCacheDirEnv === undefined) delete process.env["REACT_DOCTOR_CACHE_DIR"];
  else process.env["REACT_DOCTOR_CACHE_DIR"] = originalCacheDirEnv;
  if (originalCachePartitionEnv === undefined) delete process.env["REACT_DOCTOR_CACHE_PARTITION"];
  else process.env["REACT_DOCTOR_CACHE_PARTITION"] = originalCachePartitionEnv;
});

describe("resolveReactDoctorCacheDir", () => {
  it("honors REACT_DOCTOR_CACHE_DIR (the CI override) with a per-project subdir", () => {
    const overrideRoot = path.join(tempRoot, "ci-cache-root");
    process.env["REACT_DOCTOR_CACHE_DIR"] = overrideRoot;
    delete process.env["REACT_DOCTOR_CACHE_PARTITION"];
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

  it("uses git-relative path for cache partition when in a git repo", () => {
    const overrideRoot = path.join(tempRoot, "git-aware-cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = overrideRoot;
    delete process.env["REACT_DOCTOR_CACHE_PARTITION"];

    const gitRoot = path.join(tempRoot, "git-repo");
    const gitDir = path.join(gitRoot, ".git");
    fs.mkdirSync(gitDir, { recursive: true });

    const projectInGit = path.join(gitRoot, "packages", "app");
    fs.mkdirSync(projectInGit, { recursive: true });

    const cacheDir = resolveReactDoctorCacheDir(projectInGit);
    expect(cacheDir.startsWith(overrideRoot + path.sep)).toBe(true);

    const anotherCloneRoot = path.join(tempRoot, "another-clone");
    const anotherGitDir = path.join(anotherCloneRoot, ".git");
    fs.mkdirSync(anotherGitDir, { recursive: true });
    const sameRelativeProject = path.join(anotherCloneRoot, "packages", "app");
    fs.mkdirSync(sameRelativeProject, { recursive: true });

    const anotherCacheDir = resolveReactDoctorCacheDir(sameRelativeProject);
    expect(path.basename(cacheDir)).toBe(path.basename(anotherCacheDir));
  });

  it("honors REACT_DOCTOR_CACHE_PARTITION for explicit partition key", () => {
    const overrideRoot = path.join(tempRoot, "explicit-partition-cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = overrideRoot;
    process.env["REACT_DOCTOR_CACHE_PARTITION"] = "my-custom-partition";

    const projectA = path.join(tempRoot, "arbitrary-path-a");
    const projectB = path.join(tempRoot, "arbitrary-path-b");

    const dirA = resolveReactDoctorCacheDir(projectA);
    const dirB = resolveReactDoctorCacheDir(projectB);

    expect(path.basename(dirA)).toBe(path.basename(dirB));
  });

  it("project at git root uses '.' as relative path", () => {
    const overrideRoot = path.join(tempRoot, "git-root-cache");
    process.env["REACT_DOCTOR_CACHE_DIR"] = overrideRoot;
    delete process.env["REACT_DOCTOR_CACHE_PARTITION"];

    const gitRoot = path.join(tempRoot, "standalone-project");
    const gitDir = path.join(gitRoot, ".git");
    fs.mkdirSync(gitDir, { recursive: true });

    const cacheDir = resolveReactDoctorCacheDir(gitRoot);
    expect(cacheDir.startsWith(overrideRoot + path.sep)).toBe(true);

    const anotherClone = path.join(tempRoot, "another-standalone");
    const anotherGitDir = path.join(anotherClone, ".git");
    fs.mkdirSync(anotherGitDir, { recursive: true });

    const anotherCacheDir = resolveReactDoctorCacheDir(anotherClone);
    expect(path.basename(cacheDir)).toBe(path.basename(anotherCacheDir));
  });

  it("falls back to node_modules/.cache/react-doctor when no override is set", () => {
    delete process.env["REACT_DOCTOR_CACHE_DIR"];
    delete process.env["REACT_DOCTOR_CACHE_PARTITION"];
    const projectDir = path.join(tempRoot, "with-node-modules");
    fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
    expect(resolveReactDoctorCacheDir(projectDir)).toBe(
      path.join(projectDir, "node_modules", ".cache", "react-doctor"),
    );
  });

  it("falls back to a user-scoped OS-temp per-project dir when there is no node_modules or override", () => {
    delete process.env["REACT_DOCTOR_CACHE_DIR"];
    delete process.env["REACT_DOCTOR_CACHE_PARTITION"];
    const projectDir = path.join(tempRoot, "no-node-modules");
    fs.mkdirSync(projectDir, { recursive: true });
    const resolved = resolveReactDoctorCacheDir(projectDir);
    const scopedCacheRoot = path.dirname(resolved);
    expect(scopedCacheRoot.startsWith(os.tmpdir())).toBe(true);
    // The uid/username suffix must be present: a bare `react-doctor-cache`
    // would be the predictable world-writable path another local user can
    // pre-create and poison.
    expect(path.basename(scopedCacheRoot)).toMatch(/^react-doctor-cache-.+$/);
  });
});
