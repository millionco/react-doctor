import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";

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
});
