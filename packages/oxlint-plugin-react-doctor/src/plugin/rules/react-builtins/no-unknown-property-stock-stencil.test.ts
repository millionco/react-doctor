import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnknownProperty } from "./no-unknown-property.js";

vi.mock("../../utils/read-verified-stock-stencil-compiler.js", () => ({
  hasVerifiedStockStencilCompiler: () => true,
}));

const filesToRemove: string[] = [];
const sourcePath = "src/components/panel.tsx";
const stencilSource = `
import { Component, h } from "@stencil/core";
@Component({ tag: "sample-panel" })
export class Panel {
  render() {
    return <main class="panel" />;
  }
}
`;

const setup = (source: string, extraFiles: Readonly<Record<string, string>> = {}) => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "stencil-class-prop-"));
  filesToRemove.push(rootDirectory);
  const files = {
    "package.json": '{"scripts":{"build":"stencil build --prod"}}',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react",
        jsxFactory: "h",
        jsxFragmentFactory: "Fragment",
        experimentalDecorators: true,
      },
      include: ["src"],
      exclude: ["node_modules"],
    }),
    "stencil.config.ts": "export const config = {};",
    [sourcePath]: source,
    ...extraFiles,
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(rootDirectory, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  return { rootDirectory, filename: path.join(rootDirectory, sourcePath) };
};

afterEach(() => {
  for (const root of filesToRemove.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("native class attributes in stock Stencil JSX", () => {
  it("uses native class semantics only in the curated profile", () => {
    const { rootDirectory, filename } = setup(stencilSource);
    for (const [portedRuleMode, count] of [
      ["curated", 0],
      ["upstream", 1],
    ] as const) {
      const result = runRule(noUnknownProperty, stencilSource, {
        filename,
        settings: { "react-doctor": { rootDirectory, portedRuleMode } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    }
  });

  it.each([
    'import React from "react"; export const Page = () => <main class="panel" />;',
    "/* @jsx React.createElement */" + stencilSource,
    stencilSource.replace("render() {", "render() { const h = customFactory;"),
  ])("retains class warnings for a different or shadowed runtime", (source) => {
    const { rootDirectory, filename } = setup(source);
    const result = runRule(noUnknownProperty, source, {
      filename,
      settings: { "react-doctor": { rootDirectory } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains the class warning when an alternate Vite build is configured", () => {
    const { rootDirectory, filename } = setup(stencilSource, {
      "vite.config.ts": "export default {};",
    });
    const result = runRule(noUnknownProperty, stencilSource, {
      filename,
      settings: { "react-doctor": { rootDirectory } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
