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

  it("does not report when a local parameter shadows a React use alias", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-shadows-react-alias", {
      files: {
        "src/fixtures.ts": `
          import { use as reactUse } from "react";

          export const fixture = async ({ reactUse }: { reactUse: () => void }) => {
            const use = reactUse;
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

  it("does not report when a local parameter shadows a React namespace", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-shadows-react-namespace", {
      files: {
        "src/fixtures.ts": `
          import * as React from "react";

          export const fixture = async ({ React }: { React: { use: () => void } }) => {
            const { use } = React;
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

  it("still reports computed React use destructuring inside async components", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-computed-destructure", {
      files: {
        "src/App.tsx": `
          import * as React from "react";

          export const App = async () => {
            const { ["use"]: use } = React;
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

  it("does not treat namespace shorthand destructuring for other React exports as React use", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-from-react-namespace-shorthand", {
      files: {
        "src/fixtures.ts": `
          import * as React from "react";

          export const fixture = async () => {
            const { useState } = React;
            const use = useState;
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

  it("still reports React use after namespace destructuring aliases", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-namespace-destructure-alias", {
      files: {
        "src/App.tsx": `
          import * as React from "react";

          export const App = async () => {
            const { use: reactUse } = React;
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

  it("does not treat CommonJS shorthand destructuring for other React exports as React use", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-from-commonjs-shorthand", {
      files: {
        "src/fixtures.js": `
          const { useState } = require("react");

          export const fixture = async () => {
            const use = useState;
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

  it("still reports CommonJS React use aliases inside async components", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-commonjs", {
      files: {
        "src/App.js": `
          const React = require("react");
          const { use } = React;
          const reactUse = require("react").use;

          export const App = async () => {
            use(Promise.resolve("ok"));
            reactUse(Promise.resolve("ok"));
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

  it("still reports local CommonJS React use aliases inside async components", async () => {
    const projectDir = setupReactProject(tempRoot, "react-use-local-commonjs", {
      files: {
        "src/App.js": `
          export const App = async () => {
            const React = require("react");
            const { use } = React;
            const reactUse = React.use;

            use(Promise.resolve("ok"));
            reactUse(Promise.resolve("ok"));
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

  it("does not report hoisted local use function declarations", async () => {
    const projectDir = setupReactProject(tempRoot, "local-use-hoisted-function", {
      files: {
        "src/fixtures.ts": `
          export const fixture = async () => {
            console.log(use());

            function use() {
              return undefined;
            }
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
});
