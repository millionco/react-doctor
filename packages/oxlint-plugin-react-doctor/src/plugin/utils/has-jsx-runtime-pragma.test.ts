import { describe, expect, it } from "vite-plus/test";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { parseSourceText } from "./parse-source-file.js";

interface JsxPragmaFixture {
  readonly name: string;
  readonly sourceText: string;
  readonly hasPragma: boolean;
}

const fixtures: JsxPragmaFixture[] = [
  { name: "ordinary JSX", sourceText: "const node = <button />;", hasPragma: false },
  {
    name: "custom factory",
    sourceText: "/** @jsx factory */ const node = <button />;",
    hasPragma: true,
  },
  {
    name: "custom import source",
    sourceText: "/** @jsxImportSource preact */ const node = <button />;",
    hasPragma: true,
  },
  {
    name: "custom fragment",
    sourceText: "// @jsxFrag Fragment\nconst node = <button />;",
    hasPragma: true,
  },
  {
    name: "explicit runtime",
    sourceText: "/** @jsxRuntime classic */ const node = <button />;",
    hasPragma: true,
  },
  {
    name: "string contents",
    sourceText: 'const text = "/* @jsx factory */"; const node = <button />;',
    hasPragma: false,
  },
  {
    name: "template contents",
    sourceText: "const text = `// @jsx factory`; const node = <button />;",
    hasPragma: false,
  },
  {
    name: "unrelated comment",
    sourceText: "/** ordinary JSX description */ const node = <button />;",
    hasPragma: false,
  },
];

describe("hasJsxRuntimePragma", () => {
  it.each(fixtures)("$name", ({ sourceText, hasPragma }) => {
    const filename = "fixture.tsx";
    const program = parseSourceText({ filename, sourceText });
    if (!program) throw Error("Fixture must parse");
    expect(hasJsxRuntimePragma({ program, filename, sourceText })).toBe(hasPragma);
    expect(hasJsxRuntimePragma({ program, filename, sourceText })).toBe(hasPragma);
  });

  it.each(["fixture.js", "fixture.jsx", "fixture.mjs", "fixture.cjs"])(
    "reads only actual comments in JSX-capable JavaScript: %s",
    (filename) => {
      const sourceText = 'const text = "/* @jsx factory */"; const node = <button />;';
      const program = parseSourceText({ filename: "fixture.jsx", sourceText });
      if (!program) throw Error("Fixture must parse");
      expect(hasJsxRuntimePragma({ program, filename, sourceText })).toBe(false);
      expect(
        hasJsxRuntimePragma({
          program,
          filename,
          sourceText: "/** @jsx factory */\n" + sourceText,
        }),
      ).toBe(true);
    },
  );

  it("keys cached comment facts by exact source text", () => {
    const filename = "fixture.tsx";
    const sourceText = "const node = <button />;";
    const program = parseSourceText({ filename, sourceText });
    if (!program) throw Error("Fixture must parse");
    expect(hasJsxRuntimePragma({ program, filename, sourceText })).toBe(false);
    expect(
      hasJsxRuntimePragma({ program, filename, sourceText: "/** @jsx factory */\n" + sourceText }),
    ).toBe(true);
    expect(hasJsxRuntimePragma({ program, filename, sourceText })).toBe(false);
  });
});
