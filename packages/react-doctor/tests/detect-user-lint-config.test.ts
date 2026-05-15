import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { detectUserLintConfigPaths } from "../src/core/detect-user-lint-config.js";

let temporaryDirectory: string;

const writeJson = (targetPath: string, payload: object): void => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload));
};

const markProjectBoundary = (directory: string): void => {
  fs.mkdirSync(path.join(directory, ".git"), { recursive: true });
};

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rd-detect-lint-")));
  markProjectBoundary(temporaryDirectory);
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("detectUserLintConfigPaths", () => {
  it("returns an empty array when no lint config files exist", () => {
    expect(detectUserLintConfigPaths(temporaryDirectory)).toEqual([]);
  });

  it("detects .oxlintrc.json at the directory root", () => {
    const oxlintrcPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(oxlintrcPath, {});
    expect(detectUserLintConfigPaths(temporaryDirectory)).toEqual([oxlintrcPath]);
  });

  it("detects .eslintrc.json at the directory root", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, {});
    expect(detectUserLintConfigPaths(temporaryDirectory)).toEqual([eslintrcPath]);
  });

  it("prefers .oxlintrc.json over .eslintrc.json (first-match wins, not union)", () => {
    const oxlintrcPath = path.join(temporaryDirectory, ".oxlintrc.json");
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(oxlintrcPath, {});
    writeJson(eslintrcPath, {});

    expect(detectUserLintConfigPaths(temporaryDirectory)).toEqual([oxlintrcPath]);
  });

  it("does not pick up flat or JS configs", () => {
    fs.writeFileSync(path.join(temporaryDirectory, "eslint.config.js"), "export default [];");
    fs.writeFileSync(path.join(temporaryDirectory, ".eslintrc.cjs"), "module.exports = {};");
    fs.writeFileSync(path.join(temporaryDirectory, "oxlint.config.ts"), "export default {};");
    expect(detectUserLintConfigPaths(temporaryDirectory)).toEqual([]);
  });

  it("walks up parent directories to find a root config", () => {
    const oxlintrcPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(oxlintrcPath, {});

    const subPackageDirectory = path.join(temporaryDirectory, "packages", "frontend");
    fs.mkdirSync(subPackageDirectory, { recursive: true });

    expect(detectUserLintConfigPaths(subPackageDirectory)).toEqual([oxlintrcPath]);
  });

  it("stops the walk at a project boundary so it never reaches the user's home directory", () => {
    const innerProject = path.join(temporaryDirectory, "inner-project");
    fs.mkdirSync(innerProject, { recursive: true });
    markProjectBoundary(innerProject);

    const oxlintrcPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(oxlintrcPath, {});

    expect(detectUserLintConfigPaths(innerProject)).toEqual([]);
  });
});
