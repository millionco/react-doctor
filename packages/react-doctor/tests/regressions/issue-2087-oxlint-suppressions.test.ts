import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint, sortDiagnosticsStable } from "@react-doctor/core";
import { buildTestProject, setupReactProject, writeFile, writeJson } from "./_helpers.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-2087-"));
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const SOURCE =
  'export const Dialog = () => <div role="dialog"><input placeholder="Title" /></div>;';

describe("project bulk suppressions stay outside React Doctor's lint run", () => {
  it.each([false, true])(
    "preserves findings, paths, tsconfig and ignores with explicit paths: %s",
    async (explicit) => {
      const rootDirectory = setupReactProject(temporaryDirectory, `scope-${explicit}`, {
        files: {
          "src/Dialog.tsx": SOURCE,
          "src/ignored.tsx": SOURCE,
          ".eslintignore": "src/ignored.tsx\n",
          "src/nested/ignored.tsx": SOURCE,
          "src/nested/.oxlintrc.json": JSON.stringify({ ignorePatterns: ["ignored.tsx"] }),
        },
      });
      const options = {
        rootDirectory,
        project: { ...buildTestProject({ rootDirectory }), hasTypeScript: true },
        includePaths: explicit
          ? ["src/Dialog.tsx", "src/ignored.tsx", "src/nested/ignored.tsx"]
          : undefined,
        perFileLintCacheEnabled: false,
        customRulesOnly: true,
      };
      const baseline = await runOxlint(options);
      expect(baseline.length).toBeGreaterThan(0);
      expect(baseline.some((diagnostic) => diagnostic.filePath === "src/Dialog.tsx")).toBe(true);
      expect(baseline.some((diagnostic) => diagnostic.filePath === "src/ignored.tsx")).toBe(false);
      for (const suppression of [
        JSON.stringify({ "src/Dialog.tsx": { "eslint/no-console": { count: 1 } } }),
        JSON.stringify({
          "src/Dialog.tsx": { "react-doctor/dialog-has-accessible-name": { count: 1 } },
        }),
        "{invalid-json",
      ]) {
        const suppressionPath = path.join(rootDirectory, "oxlint-suppressions.json");
        writeFile(suppressionPath, suppression);
        expect(sortDiagnosticsStable(await runOxlint(options))).toEqual(
          sortDiagnosticsStable(baseline),
        );
        expect(fs.readFileSync(suppressionPath, "utf8")).toBe(suppression);
      }
    },
  );

  it("handles an entirely ignored selection", async () => {
    const rootDirectory = setupReactProject(temporaryDirectory, "all-ignored", {
      files: { "src/ignored.tsx": SOURCE, ".eslintignore": "src/ignored.tsx\n" },
    });
    writeJson(path.join(rootDirectory, "oxlint-suppressions.json"), {
      "src/ignored.tsx": { "eslint/no-console": { count: 1 } },
    });
    expect(
      await runOxlint({
        rootDirectory,
        project: buildTestProject({ rootDirectory }),
        includePaths: ["src/ignored.tsx"],
      }),
    ).toEqual([]);
  });
  it("keeps warm cache results independent of project suppressions", async () => {
    const rootDirectory = setupReactProject(temporaryDirectory, "warm-cache", {
      files: { "src/Dialog.tsx": SOURCE },
    });
    writeJson(path.join(rootDirectory, "oxlint-suppressions.json"), {
      "src/Dialog.tsx": { "react-doctor/dialog-has-accessible-name": { count: 1 } },
    });
    const cacheHits: number[] = [];
    const options = {
      rootDirectory,
      project: buildTestProject({ rootDirectory }),
      customRulesOnly: true,
      perFileLintCacheEnabled: true,
      onCacheStats: (hits: number) => cacheHits.push(hits),
    };
    const first = await runOxlint(options);
    expect(first.some((diagnostic) => diagnostic.rule === "dialog-has-accessible-name")).toBe(true);
    expect(await runOxlint(options)).toEqual(first);
    fs.rmSync(path.join(rootDirectory, "oxlint-suppressions.json"));
    expect(await runOxlint(options)).toEqual(first);
    expect(cacheHits).toEqual([0, 1, 1]);
  });
});
