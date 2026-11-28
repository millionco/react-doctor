import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

const rootDirectory = resolve("jsx-project");
const modernFile = "src/modern/Panel.tsx";

const runConfigured = (
  source: string,
  file = modernFile,
  automaticJsxRuntimeFiles: readonly string[] = [modernFile],
) =>
  runRule(reactInJsxScope, source, {
    filename: resolve(rootDirectory, file),
    settings: { "react-doctor": { rootDirectory, automaticJsxRuntimeFiles } },
    includeLocations: true,
  }).diagnostics;

describe("react-in-jsx-scope — configured JSX runtime", () => {
  it("skips implicit factory reads while checking explicit React tag names", () => {
    const source = [
      'import type React from "react";',
      "export const implicit = <><section /><Other.React /></>;",
      "export const direct = <React />;",
      "export const member = <React.Menu.Item />;",
      'export const bound = (React: typeof import("react")) => <React.Fragment />;',
    ].join("\n");
    expect(runConfigured(source).map(({ line }) => line)).toEqual([3, 4]);
  });

  it.each(["src/classic/Panel.tsx", "../other/src/modern/Panel.tsx"])(
    "keeps the warning for %s",
    (file) => {
      expect(runConfigured("export const panel = <section />;", file)).toHaveLength(1);
    },
  );

  it("requires an exact path inside the scanned project", () => {
    const outside = "../other/Panel.tsx";
    const source = "export const panel = <section />;";
    expect(runConfigured(source, outside, [outside])).toHaveLength(1);
    expect(runConfigured(source, modernFile, ["src/modern/*.tsx"])).toHaveLength(1);
  });

  it.each([
    "/** @jsxRuntime classic */",
    "/** @jsx createElement */",
    "/** @jsxImportSource custom */",
  ])("keeps the warning when the file declares %s", (directive) => {
    expect(runConfigured(directive + "\nexport const panel = <section />;")).toHaveLength(1);
  });
});
