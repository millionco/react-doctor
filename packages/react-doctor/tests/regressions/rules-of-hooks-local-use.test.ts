import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
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

  it("does not report a local use binding after non-ASCII source text", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-non-ascii", {
      files: {
        "src/fixtures.ts": `
          const label = "測試";

          export const fixture = async ({ use }: { use: () => void }) => {
            console.log(label, use());
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

  it("does not report a local use binding in generic async arrows", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-generic-arrow", {
      files: {
        "src/fixtures.ts": `
          interface Fixture<TValue> {
            use: () => TValue;
          }

          export const fixture = async <TValue,>({ use }: Fixture<TValue>) => {
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

  it("does not report a non-React import aliased to use", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-import-alias", {
      files: {
        "src/fixtures.ts": `
          import { fixtureUse as use } from "./helpers";

          export const fixture = async () => {
            console.log(use());
          };
        `,
        "src/helpers.ts": `
          export const fixtureUse = () => undefined;
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

  it("still reports React use aliases inside async components", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-alias", {
      files: {
        "src/App.tsx": `
          import { use as reactUse } from "react";

          export const App = async () => {
            const use = reactUse;
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

  it("does not let loop-scoped use bindings suppress outer React use", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-after-loop-binding", {
      files: {
        "src/App.tsx": `
          import { use } from "react";

          export const App = async () => {
            for (const use of [() => undefined]) {
              use();
            }

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
