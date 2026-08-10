import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diff-fast-path-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubOfflineScore = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ score: 100, label: "Perfect" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );

const duplicatedJsxFixture = (caseIdentifier: string): string =>
  setupReactProject(temporaryRoot, caseIdentifier, {
    packageJsonExtras: { type: "module" },
    files: {
      "src/index.ts": "export const version = 1;\n",
      "src/account.tsx": `export const Account = ({ value }: { value: string }) => (
  <AccountScreen><Page><section><header><Title /></header><main><Value value={value} /></main><footer><Button /></footer></section></Page></AccountScreen>
);\n`,
      "src/user.tsx": `export const User = ({ name }: { name: string }) => (
  <UserScreen><Page><section><header><Title /></header><main><Value value={name} /></main><footer><Button /></footer></section></Page></UserScreen>
);\n`,
    },
  });

describe("diff maintainability focus", () => {
  it("compares a changed file with unchanged duplicate counterparts", async () => {
    stubOfflineScore();
    const projectDirectory = duplicatedJsxFixture("changed-duplicate");
    const result = await diagnose(projectDirectory, {
      lint: false,
      deadCode: true,
      warnings: true,
      includePaths: ["src/user.tsx"],
    });

    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.rule === "duplicate-jsx-subtree",
    );
    expect(diagnostic?.filePath).toBe("src/user.tsx");
    expect(diagnostic?.relatedLocations?.[0].filePath).toBe("src/account.tsx");
  });

  it("does not report duplicate families untouched by the diff", async () => {
    stubOfflineScore();
    const projectDirectory = duplicatedJsxFixture("unrelated-change");
    const result = await diagnose(projectDirectory, {
      lint: false,
      deadCode: true,
      warnings: true,
      includePaths: ["src/index.ts"],
    });

    expect(result.diagnostics.some((candidate) => candidate.rule === "duplicate-jsx-subtree")).toBe(
      false,
    );
  });
});
