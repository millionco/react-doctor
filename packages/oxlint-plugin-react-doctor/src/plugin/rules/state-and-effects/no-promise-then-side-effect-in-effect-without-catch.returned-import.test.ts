import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

const ALIASED_CHAIN =
  'import("@/task").then(({ loadValue }) => loadValue().then(setValue)).finally(() => setLoading(false))';

let projectDirectory: string;

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-returned-import-"));
  fs.mkdirSync(path.join(projectDirectory, "src"));
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
  );
  fs.writeFileSync(
    path.join(projectDirectory, "src/task.ts"),
    `export async function loadValue() {
      const values = {};
      const key = String(Date.now());
      values[key] = true;
      return values[key];
    }`,
  );
  fs.writeFileSync(
    path.join(projectDirectory, "src/foreign.ts"),
    "export const loadValue = () => ({ then: () => true });",
  );
  fs.writeFileSync(
    path.join(projectDirectory, "src/replaced.ts"),
    "export async function loadValue() { return true; } loadValue = replacement;",
  );
});

afterEach(() => {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
});

const runReturnedImportRule = (
  chain: string,
  atomImport = 'import { atom, useAtom as useValueAtom } from "jotai";',
  setterDeclaration = "const [, setValue] = useValueAtom(valueAtom);",
  preamble = "",
) =>
  runRule(
    noPromiseThenSideEffectInEffectWithoutCatch,
    `import { useEffect, useState } from "react";
      ${atomImport}
      ${preamble}
      const valueAtom = atom(false);
      export const Panel = () => {
        ${setterDeclaration}
        const [, setLoading] = useState(true);
        useEffect(() => { ${chain}; }, []);
        return null;
      };`,
    { filename: path.join(projectDirectory, "src/Panel.tsx") },
  );

describe("returned state updates from a dynamic import", () => {
  it.each([
    ["the project alias", ALIASED_CHAIN],
    [
      "a renamed relative export in a block return",
      'import("./task").then(({ loadValue: request }) => { return request().then(setValue); })',
    ],
    [
      "a catch on the returned chain, which cannot catch the import",
      'import("@/task").then(({ loadValue }) => loadValue().then(setValue).catch(() => {}))',
    ],
    [
      "a native promise returned without reading the namespace",
      'import("@/task").then(() => Promise.resolve(true).then(setValue))',
    ],
  ])("flags %s", (_description, chain) => {
    const result = runReturnedImportRule(chain);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a terminal catch", `${ALIASED_CHAIN}.catch(() => {})`],
    [
      "an outer then rejection handler",
      'import("@/task").then(({ loadValue }) => loadValue().then(setValue), () => {}).finally(() => {})',
    ],
    [
      "a fulfillment callback after recovery rather than directly on the import",
      'import("@/task").catch(() => replacement).then(({ loadValue }) => loadValue().then(setValue))',
    ],
    [
      "detached inner work",
      'import("@/task").then(({ loadValue }) => { loadValue().then(setValue); })',
    ],
    [
      "a later callback getting a different namespace value",
      'import("@/task").then(() => replacement).then(({ loadValue }) => loadValue().then(setValue))',
    ],
    [
      "a defaulted export binding",
      'import("@/task").then(({ loadValue = replacement }) => loadValue().then(setValue))',
    ],
    ["an unknown export provider", ALIASED_CHAIN.replace("@/task", "@/unknown")],
    ["a foreign then method", ALIASED_CHAIN.replace("@/task", "@/foreign")],
    ["a mutable export", ALIASED_CHAIN.replace("@/task", "@/replaced")],
    ["an unrelated callback", ALIASED_CHAIN.replace("then(setValue)", "then(publish)")],
  ])("leaves %s quiet", (_description, chain) => {
    const result = runReturnedImportRule(chain);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["a callable export", "export const then = (resolve) => resolve({ loadValue: replacement });"],
    ["a renamed re-export", 'export { loadValue as then } from "./task";'],
    ["a destructured export", "export const { then } = replacement;"],
    ["an unknown wildcard export", 'export * from "./unknown";'],
  ])("does not assume the namespace reaches the callback with %s", (_description, extraExport) => {
    fs.writeFileSync(
      path.join(projectDirectory, "src/namespace.ts"),
      `export async function loadValue() { return true; } ${extraExport}`,
    );
    const result = runReturnedImportRule(ALIASED_CHAIN.replace("@/task", "@/namespace"));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not mistake a type-only then export for namespace assimilation", () => {
    fs.writeFileSync(
      path.join(projectDirectory, "src/namespace.ts"),
      "export async function loadValue() { return true; } export type then = never;",
    );
    const result = runReturnedImportRule(ALIASED_CHAIN.replace("@/task", "@/namespace"));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a foreign useAtom or a mutable tuple binding as a Jotai setter", () => {
    const foreign = runReturnedImportRule(
      ALIASED_CHAIN,
      'import { atom, useAtom as useValueAtom } from "other-atoms";',
    );
    const mutable = runReturnedImportRule(
      ALIASED_CHAIN,
      undefined,
      "let [, setValue] = useValueAtom(valueAtom); setValue = publish;",
    );
    expect(foreign.parseErrors).toEqual([]);
    expect(mutable.parseErrors).toEqual([]);
    expect(foreign.diagnostics).toHaveLength(0);
    expect(mutable.diagnostics).toHaveLength(0);
  });

  it("does not mistake a computed local accumulator write for a promise method replacement", () => {
    const result = runReturnedImportRule(
      ALIASED_CHAIN,
      undefined,
      undefined,
      'const values = [{ key: "ready" }]; values.reduce((accumulator, value) => { accumulator[value.key] = true; return accumulator; }, {});',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "Promise.prototype.then = replacement;",
    'const getPrototype = "get" + "PrototypeOf"; Object[getPrototype]((async () => {})()).then = replacement;',
    'const runtime = globalThis; runtime["Promise"].prototype.then = replacement;',
  ])("does not assume a native Promise method after a visible replacement: %s", (preamble) => {
    const result = runReturnedImportRule(ALIASED_CHAIN, undefined, undefined, preamble);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
