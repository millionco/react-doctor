import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

let directory: string;
const collector = `export function makeBucket() {
  let pending: Function[] = [];
  let api = {
    ignored(value) { Object.assign(value, { active: true }); return this; },
    keep(callback: () => void) {
      if (!pending.includes(callback)) pending.push(callback);
      return () => { const index = pending.indexOf(callback); if (index >= 0) for (const release of pending.splice(index, 1)) release(); };
    },
    flush() { for (const callback of pending.splice(0)) callback(); },
  };
  return api;
}`;
const component = `import { useEffect } from "react";
import { makeBucket } from "./collector";
export const View = ({ element }) => {
  useEffect(() => {
    let bucket = makeBucket();
    const observer = new ResizeObserver(() => {});
    observer.observe(element);
    bucket.keep(() => observer.disconnect());
    return () => bucket.flush();
  }, [element]);
  return null;
};`;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-observer-bag-"));
  resetModuleResolutionCaches();
  resetCrossFileExportCaches();
  __clearParseSourceFileCacheForTests();
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const run = (code = component, helper = collector) => {
  fs.writeFileSync(path.join(directory, "collector.ts"), helper);
  const filename = path.join(directory, "view.tsx");
  fs.writeFileSync(filename, code);
  const result = runRule(effectObserverNeedsDisconnect, code, { filename, includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("imported closed observer callback collectors", () => {
  it("proves a fresh unreassigned let collector with deduplication and unused sibling methods", () =>
    expect(run()).toHaveLength(0));
  it("proves arbitrary registration and drain names from source", () =>
    expect(
      run(
        component.replaceAll("keep", "retain").replaceAll("flush", "release"),
        collector.replaceAll("keep", "retain").replaceAll("flush", "release"),
      ),
    ).toHaveLength(0));
  it("supports direct return of the API literal", () =>
    expect(
      run(component, collector.replace("let api =", "return").replace("return api;", "")),
    ).toHaveLength(0));
  it("supports direct callback retention without deduplication", () =>
    expect(
      run(
        component,
        collector.replace(
          "if (!pending.includes(callback)) pending.push(callback);",
          "pending.push(callback);",
        ),
      ),
    ).toHaveLength(0));
  it("keeps separately guarded native observer bindings independent", () =>
    expect(
      run(
        component
          .replace(
            "const observer =",
            "if (typeof ResizeObserver !== 'undefined') { const observer =",
          )
          .replace(
            "return () => bucket.flush();",
            "} if (typeof IntersectionObserver !== 'undefined') { const second = new IntersectionObserver(() => {}); second.observe(element); bucket.keep(() => second.disconnect()); } return () => bucket.flush();",
          ),
      ),
    ).toHaveLength(0));
  it("supports a direct readonly local observer callback", () =>
    expect(
      run(
        component
          .replace("let bucket =", "const notify = () => handler(); let bucket =")
          .replace("new ResizeObserver(() => {})", "new ResizeObserver(notify)"),
      ),
    ).toHaveLength(0));
  it("supports a relative re-export", () => {
    fs.writeFileSync(
      path.join(directory, "bridge.ts"),
      'export { makeBucket } from "./collector";',
    );
    expect(run(component.replace('"./collector"', '"./bridge"'))).toHaveLength(0);
  });
  it.each([
    [
      "no-op disposal",
      collector.replace("for (const callback of pending.splice(0)) callback();", ""),
    ],
    ["conditional drain", collector.replace("callback(); },", "if (flag) callback(); },")],
    ["wrong drain storage", collector.replace("pending.splice(0)", "[].splice(0)")],
    ["wrong callback invocation", collector.replace("callback(); },", "other(); },")],
    ["conditional retention", collector.replace("!pending.includes(callback)", "enabled")],
    ["callback substituted", collector.replace("pending.push(callback)", "pending.push(() => {})")],
    ["different method getter", collector.replace("flush()", "get flush()")],
    ["duplicated member", collector.replace("flush() {", "flush() {}, flush() {")],
    ["private storage reassigned", collector.replace("let api =", "pending = []; let api =")],
    [
      "storage escapes during construction",
      collector.replace("let api =", "unknown(pending); let api ="),
    ],
    ["factory async", collector.replace("function makeBucket", "async function makeBucket")],
    [
      "factory pattern declaration escape",
      collector.replace("return api;", "let { missing = publish(api) } = []; return api;"),
    ],
    ["factory pattern replaced", collector + "\n({ makeBucket } = replacement);"],
    ["factory for-of replaced", collector + "\nfor (makeBucket of replacements) {}"],
    ["factory binding replaced", collector + "\nmakeBucket = alternate;"],
    ["factory opaque return", collector.replace("return api;", "return unknown(api);")],
    ["array prototype carrier replacement", collector + "\n[].__proto__.splice = () => [];"],
    ["native array replacement", collector + "\nArray.prototype.splice = () => [];"],
    [
      "native reflective replacement",
      collector + "\nReflect.set(Array.prototype, 'push', () => {});",
    ],
  ])("retains warning for unsupported factory: %s", (_name, helper) =>
    expect(run(component, helper)).toHaveLength(1),
  );
  it("preserves the existing shadowed-constructor exclusion without new cleanup credit", () =>
    expect(run(component.replace("({ element })", "({ element, ResizeObserver })"))).toHaveLength(
      0,
    ));
  it.each([
    [
      "native callback second instance",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver((entries, sameObserver) => { sameObserver.disconnect = () => {}; })",
      ),
    ],
    [
      "native callback this instance",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver(function () { this.disconnect = () => {}; })",
      ),
    ],
    [
      "native callback rest instance escape",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver((...values) => unknown(values))",
      ),
    ],
    [
      "native callback arguments instance escape",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver(function () { unknown(arguments); })",
      ),
    ],
    [
      "native callback second instance escape",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver((entries, sameObserver) => unknown(sameObserver))",
      ),
    ],
    [
      "native callback self invocation",
      component.replace(
        "new ResizeObserver(() => {})",
        "new ResizeObserver(function Again(entries) { Again(entries); })",
      ),
    ],
    [
      "opaque callback",
      component.replace("new ResizeObserver(() => {})", "new ResizeObserver(opaque)"),
    ],
    [
      "named effect callback exposure",
      component
        .replace("useEffect(() =>", "useEffect(function Again()")
        .replace("let bucket =", "enqueue(Again); let bucket ="),
    ],
    ["async effect entry", component.replace("useEffect(() =>", "useEffect(async () =>")],
    ["generator effect entry", component.replace("useEffect(() =>", "useEffect(function* ()")],
    [
      "effect default parameter",
      component.replace("useEffect(() =>", "useEffect((value = opaque()) =>"),
    ],
    [
      "async cleanup",
      component.replace("return () => bucket.flush();", "return async () => bucket.flush();"),
    ],
    [
      "generator cleanup",
      component.replace("return () => bucket.flush();", "return function* () { bucket.flush(); };"),
    ],
    [
      "cleanup default parameter",
      component.replace(
        "return () => bucket.flush();",
        "return (value = opaque()) => bucket.flush();",
      ),
    ],
    [
      "opaque call before cleanup release",
      component.replace(
        "return () => bucket.flush();",
        "return () => { opaque(); bucket.flush(); };",
      ),
    ],
    ["missing registration", component.replace("bucket.keep(() => observer.disconnect());", "")],
    [
      "earlier throwing callback",
      component.replace(
        "const observer =",
        'bucket.keep(() => { throw new Error("unavailable"); }); const observer =',
      ),
    ],
    [
      "earlier opaque callback",
      component.replace("const observer =", "bucket.keep(opaque); const observer ="),
    ],
    [
      "callback result used",
      component.replace(
        "bucket.keep(() => observer.disconnect());",
        "const remove = bucket.keep(() => observer.disconnect()); remove();",
      ),
    ],
    [
      "collector escape",
      component.replace("const observer =", "unknown(bucket); const observer ="),
    ],
    [
      "collector replacement",
      component.replace("const observer =", "bucket = makeBucket(); const observer ="),
    ],
    [
      "method replacement",
      component.replace("const observer =", "bucket.flush = () => {}; const observer ="),
    ],
    [
      "ignored sibling invoked",
      component.replace("const observer =", "bucket.ignored({}); const observer ="),
    ],
    [
      "wrong cleanup instance",
      component.replace("return () => bucket.flush()", "return () => makeBucket().flush()"),
    ],
    [
      "conditional registration",
      component.replace(
        "bucket.keep(() => observer.disconnect());",
        "if (enabled) bucket.keep(() => observer.disconnect());",
      ),
    ],
    [
      "conditional cleanup",
      component.replace(
        "return () => bucket.flush();",
        "return () => { if (enabled) bucket.flush(); };",
      ),
    ],
    [
      "cleanup observes again",
      component.replace(
        "return () => bucket.flush();",
        "return () => { bucket.flush(); observer.observe(element); };",
      ),
    ],
    [
      "React namespace replacement",
      component + "\nimport React from 'react'; React.useEffect = alternate;",
    ],
    [
      "cleanup early return",
      component.replace(
        "return () => bucket.flush();",
        "return () => { if (enabled) return; bucket.flush(); };",
      ),
    ],
    [
      "wrong observer released",
      component.replace("observer.disconnect()", "different.disconnect()"),
    ],
    [
      "observer escapes",
      component.replace(
        "observer.observe(element);",
        "observer.observe(element); unknown(observer);",
      ),
    ],
    [
      "observer method replaced",
      component.replace(
        "observer.observe(element);",
        "observer.observe(element); observer.disconnect = () => {};",
      ),
    ],
    ["constructor exposed", component + "\nunknown(ResizeObserver);"],
    ["canonical provider replacement", component + "\nglobalThis.ResizeObserver = Replacement;"],
    [
      "native execution module import",
      component +
        '\nimport { runInThisContext } from "node:vm"; runInThisContext("Array.prototype.splice = () => []");',
    ],
    [
      "native module loader import",
      component +
        '\nimport { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("react").useEffect = alternate;',
    ],
    ["dynamic execution", component + '\nFunction("Array.prototype.splice = () => []")();'],
    ["unresolved computed native exposure", component + "\nconst execute = (() => {})[key];"],
    [
      "factory mutable alias",
      component
        .replace("import { makeBucket }", "import { makeBucket as original }")
        .replace("export const View", "let makeBucket = original; export const View"),
    ],
    ["unproven React hook", component.replace('import { useEffect } from "react";', "")],
    [
      "type-only factory import",
      component.replace("import { makeBucket }", "import type { makeBucket }"),
    ],
  ])("retains warning for unsupported caller: %s", (_name, code) =>
    expect(run(code)).toHaveLength(1),
  );
});

describe("direct returned collector cleanup", () => {
  it("retains a finally override of the returned cleanup", () =>
    expect(
      run(
        component.replace(
          "return () => bucket.flush();",
          "try { return () => bucket.flush(); } finally { return () => {}; }",
        ),
      ),
    ).toHaveLength(1));
  it("retains a conditional returned no-op alternative", () =>
    expect(
      run(
        component.replace(
          "return () => bucket.flush();",
          "return enabled ? () => bucket.flush() : () => {};",
        ),
      ),
    ).toHaveLength(1));
});

describe("collector dependency probes", () => {
  it("records the imported helper on repeated dependency collection", () => {
    run();
    const filename = path.join(directory, "view.tsx");
    const collect = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: component,
        ruleIds: ["effect-observer-needs-disconnect"],
      });
    expect(collect()?.contentPaths.has(path.join(directory, "collector.ts"))).toBe(true);
    expect(collect()?.contentPaths.has(path.join(directory, "collector.ts"))).toBe(true);
  });
  it("changes the verdict after a helper edit under a fresh lint analysis", () => {
    expect(run()).toHaveLength(0);
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    __clearParseSourceFileCacheForTests();
    expect(
      run(
        component,
        collector.replace("for (const callback of pending.splice(0)) callback();", ""),
      ),
    ).toHaveLength(1);
  });
  it("records absent resolution candidates and accepts a newly available helper", () => {
    const filename = path.join(directory, "view.tsx");
    fs.writeFileSync(filename, component);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: component,
      ruleIds: ["effect-observer-needs-disconnect"],
    });
    expect(trace?.existencePaths.has(path.join(directory, "collector.ts"))).toBe(true);
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    __clearParseSourceFileCacheForTests();
    expect(run()).toHaveLength(0);
  });
});

describe("erased collector provider declarations", () => {
  it.each([
    "declare const Object: any;",
    "interface Object {}",
    'import type Object from "provider-types";',
  ])("retains the observer warning under %s", (declaration) => {
    const mutation =
      'Object.defineProperty(Object.getPrototypeOf([]), "splice", { value: () => [] });';
    expect(run(component, declaration + mutation + collector)).toHaveLength(1);
  });
  it("ignores an unused erased provider declaration", () => {
    expect(run(component, "declare const Object: any;" + collector)).toHaveLength(0);
  });
});

describe("collector provider runtime value bindings", () => {
  const mutation =
    'Object.defineProperty(Object.getPrototypeOf([]), "splice", { value: () => [] });';
  it("retains the warning under a type-only import-equals binding", () => {
    expect(
      run(component, 'import type Object = require("provider-types");' + mutation + collector),
    ).toHaveLength(1);
  });
  it.each([
    'import Object = require("provider-values");',
    "const Object = { defineProperty: () => null, getPrototypeOf: () => ({}) }; interface Object {}",
  ])("preserves genuine local value binding %s", (declaration) => {
    expect(run(component, declaration + mutation + collector)).toHaveLength(0);
  });
});

describe("erased collector provider namespaces", () => {
  const mutation =
    'Object.defineProperty(Object.getPrototypeOf([]), "splice", { value: () => [] });';
  it.each([
    "namespace Object {}",
    "namespace Object { export interface Marker {} }",
    "namespace Object { export namespace Nested { export type Marker = unknown; } }",
  ])("retains the observer warning under %s", (declaration) => {
    expect(run(component, declaration + mutation + collector)).toHaveLength(1);
  });
  it("preserves a genuine runtime namespace", () => {
    expect(
      run(component, "namespace Object { export const marker = 1; } void Object;" + collector),
    ).toHaveLength(0);
  });
});
