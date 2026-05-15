import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { shouldSuppressLocalUseHookDiagnostic } from "../../../core/src/runners/oxlint/should-suppress-local-use-hook-diagnostic.js";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rules-of-hooks-fp-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("rules-of-hooks local use false positives", () => {
  it("does not report a destructured fixture callback named use", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-fixture", {
      files: {
        "src/fixtures.ts": `
          export const fixture = async ({ use }: { use: () => void }) => {
            console.log(use());
          };
        `,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-hooks" && diagnostic.rule === "rules-of-hooks",
      ),
    ).toHaveLength(0);
  });

  it("still reports React use inside async components", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-async", {
      files: {
        "src/App.tsx": `
          import { use } from "react";

          export const App = async () => {
            use(Promise.resolve("ok"));
            return null;
          };
        `,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.plugin === "react-hooks" && diagnostic.rule === "rules-of-hooks",
      ),
    ).toBe(true);
  });

  it("does not suppress diagnostics for async methods named use", () => {
    const sourceText = `
      import { use } from "react";

      export const fixture = {
        async use() {
          use(Promise.resolve("ok"));
        },
      };
    `;
    const projectDir = setupReactProject(tempRoot, "react-use-async-method", {
      files: {
        "src/fixture.ts": sourceText,
      },
    });

    const asyncOffset = sourceText.indexOf("async use");
    const useCallOffset = sourceText.indexOf('use(Promise.resolve("ok"))');

    expect(
      shouldSuppressLocalUseHookDiagnostic(
        {
          code: "react-hooks(rules-of-hooks)",
          message: 'React Hook "use" cannot be called in an async function.',
          filename: path.join(projectDir, "src/fixture.ts"),
          labels: [
            {
              label: 'React Hook "use" cannot be called in an async function.',
              span: { offset: useCallOffset, length: "use".length },
            },
            {
              label: "This function is async.",
              span: { offset: asyncOffset, length: "async".length },
            },
          ],
        },
        projectDir,
      ),
    ).toBe(false);
  });
});
