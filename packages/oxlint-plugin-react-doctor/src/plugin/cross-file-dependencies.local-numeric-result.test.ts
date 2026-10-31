import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "./cross-file-dependencies.js";
import { jsxNumericAndLeakedRender } from "./rules/correctness/jsx-numeric-and-leaked-render.js";
import { resetCrossFileExportCaches } from "./utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "./utils/resolve-relative-import-path.js";

const numericProvider =
  "export function useEntries(items) { const count=Array.isArray(items)?items.length:undefined; return {count}; }";
const booleanProvider =
  "export function useEntries(items) { const count=Array.isArray(items)&&items.length>0; return {count}; }";
const componentSource =
  'import {useEntries} from "./use-entries"; export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output>Ready</output>}</section>;};';
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "numeric-result-deps-"));
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const collect = (sourceText = componentSource) => {
  fs.writeFileSync(path.join(temporaryDirectory, "Example.tsx"), sourceText);
  return collectCrossFileDependencyProbes({
    absoluteFilePath: path.join(temporaryDirectory, "Example.tsx"),
    sourceText,
    ruleIds: ["jsx-numeric-and-leaked-render"],
  });
};
const analyze = (sourceText = componentSource) => {
  fs.writeFileSync(path.join(temporaryDirectory, "Example.tsx"), sourceText);
  return runRule(jsxNumericAndLeakedRender, sourceText, {
    filename: path.join(temporaryDirectory, "Example.tsx"),
    forceJsx: true,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        portedRuleMode: "curated",
        rootDirectory: temporaryDirectory,
      },
    },
  });
};

describe("local numeric result dependency integration", () => {
  it("records the provider and observes a changed returned field", () => {
    const provider = path.join(temporaryDirectory, "use-entries.tsx");
    fs.writeFileSync(provider, numericProvider);
    expect(collect()?.contentPaths.has(provider)).toBe(true);
    const before = analyze();
    expect(before.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(1);
    fs.writeFileSync(provider, booleanProvider);
    const after = analyze();
    expect(after.parseErrors).toEqual([]);
    expect(after.diagnostics).toEqual([]);
  });
  it("records an absent preferred extension and follows it on the next resolution batch", () => {
    const preferred = path.join(temporaryDirectory, "use-entries.ts");
    const fallback = path.join(temporaryDirectory, "use-entries.tsx");
    fs.writeFileSync(fallback, numericProvider);
    const before = collect();
    expect(fs.existsSync(preferred)).toBe(false);
    expect(before?.existencePaths.has(preferred)).toBe(true);
    expect(before?.contentPaths.has(fallback)).toBe(true);
    expect(analyze().diagnostics).toHaveLength(1);
    fs.writeFileSync(preferred, booleanProvider);
    resetCrossFileExportCaches();
    resetModuleResolutionCaches();
    const after = collect();
    expect(after?.contentPaths.has(preferred)).toBe(true);
    expect(after?.contentPaths.has(fallback)).toBe(false);
    const result = analyze();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("records both re-export and provider without unrelated source", () => {
    const barrel = path.join(temporaryDirectory, "entry.ts");
    const provider = path.join(temporaryDirectory, "use-entries.ts");
    const unrelated = path.join(temporaryDirectory, "unrelated.ts");
    fs.writeFileSync(barrel, 'export {useEntries} from "./use-entries";');
    fs.writeFileSync(provider, numericProvider);
    fs.writeFileSync(unrelated, "export const unrelated=true;");
    const source = componentSource.replace('"./use-entries"', '"./entry"');
    const trace = collect(source);
    expect(trace?.contentPaths.has(barrel)).toBe(true);
    expect(trace?.contentPaths.has(provider)).toBe(true);
    expect(trace?.contentPaths.has(unrelated)).toBe(false);
    const result = analyze(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
