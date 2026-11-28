import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

const DIRECT_BUILD = "tsc --project tsconfig.json";
const JSX = "export const Panel = () => <section />;";
const AUTOMATIC_PRAGMA = "/** @jsxRuntime automatic */\n";

const withProject = (
  jsx: string,
  source: string,
  callback: (root: string, filename: string) => void,
  options: { build?: string; relativeDirectory?: string; typescript?: string } = {},
) => {
  const root = mkdtempSync(join(tmpdir(), "typescript-jsx-pragma-"));
  const directory = join(root, options.relativeDirectory ?? "src");
  const filename = join(directory, "Panel.tsx");
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(filename, source);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { build: options.build ?? DIRECT_BUILD },
        devDependencies: { typescript: options.typescript ?? "5.9.3" },
      }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx }, include: ["src/**/*.tsx"] }),
    );
    callback(root, filename);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("explicit automatic TypeScript JSX runtime", () => {
  it.each(["react", "react-jsx", "react-jsxdev"])(
    "honors the file pragma for a directly configured %s emitter",
    (jsx) => {
      const source = AUTOMATIC_PRAGMA + JSX;
      withProject(jsx, source, (root, filename) => {
        writeFileSync(
          join(root, "tsconfig.classic.json"),
          JSON.stringify({ compilerOptions: { jsx: "react" }, include: ["src/**/*.tsx"] }),
        );
        expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toEqual([]);
      });
    },
  );

  it("checks unbound React tags in an automatic file and honors lexical value bindings", () => {
    const source =
      AUTOMATIC_PRAGMA +
      [
        "export const host = <><section /><Other.React /></>;",
        "export const direct = <React />;",
        "export const member = <React.Menu.Item />;",
        'export const bound = (React: typeof import("react")) => <React.Fragment />;',
        "export const sibling = () => <React.Fragment />;",
      ].join("\n");
    withProject("react", source, (_root, filename) => {
      const result = runRule(reactInJsxScope, source, { filename, includeLocations: true });
      expect(result.diagnostics.map(({ line }) => line)).toEqual([3, 4, 6]);
    });
  });

  it("requires a value even when an automatic file imports the React type", () => {
    const source =
      AUTOMATIC_PRAGMA +
      [
        'import type React from "react";',
        "export const host = <section />;",
        "export const member = <React.Fragment />;",
      ].join("\n");
    withProject("react-jsx", source, (_root, filename) => {
      const result = runRule(reactInJsxScope, source, { filename, includeLocations: true });
      expect(result.diagnostics.map(({ line }) => line)).toEqual([4]);
    });
  });

  it.each(["react", "react-jsx", "react-jsxdev"])(
    "keeps the warning for an unannotated file under %s",
    (jsx) => {
      withProject(jsx, JSX, (_root, filename) => {
        expect(runRule(reactInJsxScope, JSX, { filename }).diagnostics).toHaveLength(1);
      });
    },
  );

  it.each([
    ["/** @jsxRuntime automatic*/", "a missing argument separator"],
    [AUTOMATIC_PRAGMA + "/** @JSXRUNTIME classic */", "a later mixed-case classic pragma"],
    [AUTOMATIC_PRAGMA + "/** @JSX React.createElement */", "a conflicting mixed-case factory"],
    ["/** @jsxRuntime classic */", "a classic pragma"],
    ["const text = `/** @jsxRuntime automatic */`;", "a pragma inside a string"],
  ])("keeps the warning for %s (%s)", (pragma) => {
    const source = pragma + "\n" + JSX;
    withProject("react", source, (_root, filename) => {
      expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
    });
  });

  it.each(["5.5.4", "^5.9.3"])(
    "keeps the warning when the TypeScript declaration is %s",
    (typescript) => {
      const source = AUTOMATIC_PRAGMA + JSX;
      withProject(
        "react",
        source,
        (_root, filename) => {
          expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
        },
        { typescript },
      );
    },
  );

  it.each([
    { dependencies: { typescript: "5.9.3" }, optionalDependencies: { typescript: "5.5.4" } },
    { dependencies: { typescript: "5.5.4" }, devDependencies: { typescript: "5.9.3" } },
    { devDependencies: { typescript: "5.9.3" }, optionalDependencies: { tsc: "2.0.4" } },
  ])("keeps the warning for a competing compiler declaration", (dependencies) => {
    const source = AUTOMATIC_PRAGMA + JSX;
    withProject("react", source, (root, filename) => {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { build: DIRECT_BUILD }, ...dependencies }),
      );
      expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
    });
  });

  it("keeps the warning when TypeScript leaves JSX for another compiler", () => {
    const source = AUTOMATIC_PRAGMA + JSX;
    withProject("preserve", source, (_root, filename) => {
      expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
    });
  });

  it("keeps the warning when a different build command selects the transform", () => {
    const source = AUTOMATIC_PRAGMA + JSX;
    withProject(
      "react",
      source,
      (_root, filename) => {
        expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
      },
      { build: "node compiler.cjs" },
    );
  });

  it("keeps the warning when the selected project excludes the file", () => {
    const source = AUTOMATIC_PRAGMA + JSX;
    withProject(
      "react",
      source,
      (_root, filename) => {
        expect(runRule(reactInJsxScope, source, { filename }).diagnostics).toHaveLength(1);
      },
      { relativeDirectory: "src/.generated" },
    );
  });

  it("uses configuration probes only when the file declares the automatic runtime", () => {
    const source = AUTOMATIC_PRAGMA + JSX;
    withProject("react", source, (root, filename) => {
      const collect = (sourceText: string) =>
        collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText,
          ruleIds: ["react-in-jsx-scope"],
        });
      const probes = collect(source);
      expect(probes?.contentPaths.has(join(root, "package.json"))).toBe(true);
      expect(probes?.contentPaths.has(join(root, "tsconfig.json"))).toBe(true);
      expect(probes?.existencePaths.has(join(root, "pnpm-workspace.yaml"))).toBe(true);
      expect(collect(JSX)?.contentPaths.size).toBe(0);
      expect(collect(JSX)?.existencePaths.size).toBe(0);
    });
  });
});
