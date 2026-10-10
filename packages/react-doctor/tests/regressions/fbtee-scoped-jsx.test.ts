/**
 * Regression test for issue #1951: fbtee scoped JSX React Compiler bailout.
 *
 * React Doctor missed React Compiler bailouts on fbtee's scoped JSX before
 * the fbtee transform. The diagnostic appeared only after `<fbt>` was
 * transformed to `fbt._()`, not on the source where the scoped binding was
 * used in JSX form.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { inspect } from "../../src/inspect.js";
import { setupReactProject, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fbtee-scoped-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("issue #1951: fbtee scoped JSX React Compiler bailout", () => {
  it("reports fbtee scoped JSX at source level", async () => {
    const projectDir = setupReactProject(tempRoot, "scoped-jsx", {
      packageJsonExtras: {
        dependencies: {
          fbtee: "^5.0.0",
        },
      },
      files: {
        "babel.config.json": JSON.stringify({
          plugins: ["babel-plugin-react-compiler"],
        }),
        "LocalJsx.tsx": `
          import { useFbt } from 'fbtee';
          
          export const LocalJsx = () => {
            const { fbt } = useFbt();
            return <button><fbt desc="Save button label">Save</fbt></button>;
          };
        `,
      },
    });

    const result = await inspect(projectDir, { lint: true, noScore: true, silent: true });
    const fbteeRule = result.diagnostics.find((d) => d.rule === "fbtee-scoped-jsx-compiler-bailout");

    if (!fbteeRule) {
      console.log("All diagnostics:", result.diagnostics.map((d) => ({ rule: d.rule, file: d.filePath })));
    }

    expect(fbteeRule).toBeDefined();
    expect(fbteeRule?.message).toContain("React Compiler will bail out");
    expect(fbteeRule?.severity).toBe("error");
  });

  it("does not report when using global fbt import", async () => {
    const projectDir = setupReactProject(tempRoot, "global-fbt", {
      packageJsonExtras: {
        dependencies: {
          fbtee: "^5.0.0",
        },
      },
      files: {
        "babel.config.json": JSON.stringify({
          plugins: ["babel-plugin-react-compiler"],
        }),
        "GlobalFbt.tsx": `
          import fbt from 'fbtee';
          
          export const GlobalFbt = () => {
            return <button><fbt desc="Save button label">Save</fbt></button>;
          };
        `,
      },
    });

    const result = await inspect(projectDir, { lint: true, noScore: true, silent: true });
    const fbteeRule = result.diagnostics.find((d) => d.rule === "fbtee-scoped-jsx-compiler-bailout");

    expect(fbteeRule).toBeUndefined();
  });
});
