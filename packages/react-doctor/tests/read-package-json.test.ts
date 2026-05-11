import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { clearPackageJsonCache, readPackageJson } from "../src/utils/read-package-json.js";

describe("readPackageJson", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-package-json-"));
    clearPackageJsonCache();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    clearPackageJsonCache();
  });

  it("caches parsed package JSON by absolute path", () => {
    const packageJsonPath = path.join(directory, "package.json");
    fs.writeFileSync(packageJsonPath, JSON.stringify({ name: "first" }));

    expect(readPackageJson(packageJsonPath)).toEqual({ name: "first" });

    fs.writeFileSync(packageJsonPath, JSON.stringify({ name: "second" }));

    expect(readPackageJson(packageJsonPath)).toEqual({ name: "first" });

    clearPackageJsonCache();

    expect(readPackageJson(packageJsonPath)).toEqual({ name: "second" });
  });

  it("returns an empty object for invalid JSON and directories", () => {
    const invalidJsonPath = path.join(directory, "invalid.json");
    const directoryPath = path.join(directory, "package.json");
    fs.writeFileSync(invalidJsonPath, "{");
    fs.mkdirSync(directoryPath);

    expect(readPackageJson(invalidJsonPath)).toEqual({});
    expect(readPackageJson(directoryPath)).toEqual({});
  });
});
