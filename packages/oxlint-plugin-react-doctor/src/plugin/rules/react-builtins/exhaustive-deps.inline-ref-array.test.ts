import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const inlineArray = "const held = useRef(Array(3).fill(0).map(() => 1)).current;";
const readArray = "useEffect(() => { consume(held.map(item => item)); }, []);";
const writeSlots = "held.forEach((_, index) => { held[index] = value; });";

const analyzePanel = (setup: string, effects: string, prelude = "", filename = "fixture.tsx") => {
  const result = runRule(
    exhaustiveDeps,
    `import { useEffect, useRef } from "react";
     declare function consume(value: unknown): void;
     ${prelude}
     export function Panel({ value }: { value: number }) {
       ${setup}
       ${effects}
       return null;
     }`,
    { filename },
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ message }) => message);
};

describe("exhaustive-deps inline ref array captures", () => {
  it("accepts array methods and numeric writes owned by the same effect", () => {
    expect(
      analyzePanel(
        inlineArray,
        "useEffect(() => { held.map(item => consume(item)); held.forEach((_, index) => { held[index] = 2; }); }, []);",
      ),
    ).toEqual([]);
  });

  it("retains the dependency for a render-time array write", () => {
    expect(analyzePanel(`${inlineArray}\n${writeSlots}`, readArray)).toEqual([
      expect.stringContaining("stale `held.map`"),
    ]);
  });

  it("retains the dependency for a write owned by a different effect", () => {
    expect(
      analyzePanel(inlineArray, `useEffect(() => { ${writeSlots} }, [value]);\n${readArray}`),
    ).toEqual([expect.stringContaining("stale `held.map`")]);
  });

  it("retains a dependency on a captured changing member", () => {
    expect(
      analyzePanel(
        "const held = useRef({ value }).current; held.value = value;",
        "useEffect(() => { const { value: snapshot } = held; consume(snapshot); }, []);",
      ),
    ).toEqual([expect.stringContaining("stale `held.value`")]);
  });

  it("retains the dependency when the array provider can be replaced", () => {
    expect(
      analyzePanel(
        inlineArray,
        readArray,
        "const prototype = Object.getPrototypeOf([]); prototype.map = alternate;",
      ),
    ).toEqual([expect.stringContaining("stale `held.map`")]);
  });

  it("keeps reporting unrelated props captured by the same effect", () => {
    expect(
      analyzePanel(
        inlineArray,
        "useEffect(() => { held.forEach(item => consume(item)); consume(value); }, []);",
      ),
    ).toEqual([expect.stringContaining("stale `value`")]);
  });

  it.each([
    { alias: "react", expectation: [expect.stringContaining("stale `held.map`")] },
    { alias: "@/*", expectation: [] },
  ])("checks a project paths mapping for $alias", ({ alias, expectation }) => {
    const directory = mkdtempSync(join(tmpdir(), "exhaustive-deps-inline-ref-provider-"));
    const filename = join(directory, "fixture.tsx");
    try {
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { [alias]: ["./fake-react.ts"] } },
        }),
      );
      writeFileSync(
        join(directory, "fake-react.ts"),
        "export function useRef(current: unknown) { return { current }; }",
      );
      expect(analyzePanel(inlineArray, readArray, "", filename)).toEqual(expectation);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains the dependency when source uses a dynamic React loader", () => {
    const prelude =
      'const provider = await import("react"); provider.default.useRef = replacementRef;';
    expect(analyzePanel(inlineArray, readArray, prelude)).toEqual([
      expect.stringContaining("stale `held.map`"),
    ]);
  });
});
