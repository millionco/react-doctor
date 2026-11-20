import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

const component = `import { useState } from "react";
const formatPageCount = (count: number) => {
  if (count < 1) return "Empty";
  return count + " pages";
};
export const PageCounter = ({ pages }: { pages: number }) => {
  const [resultSize, setResultSize] = useState("");
  return <section>
    <button type="button" onClick={() => setResultSize(formatPageCount(pages))}>Count</button>
    {resultSize && <output>{resultSize}</output>}
  </section>;
};`;

const warningCount = (source: string): number => {
  const result = runRule(renderingConditionalRender, source);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("rendering-conditional-render — closed string state", () => {
  it("allows a string initializer and closed formatter", () => {
    expect(warningCount(component)).toBe(0);
  });

  it("allows direct string writes and a conditional string formatter", () => {
    const direct = component.replace("formatPageCount(pages)", '"Ready"');
    expect(warningCount(direct)).toBe(0);
    const conditional = component.replace(
      'if (count < 1) return "Empty";\n  return count + " pages";',
      'return count < 1 ? "Empty" : count + " pages";',
    );
    expect(warningCount(conditional)).toBe(0);
  });

  it("reports numeric values from either the initializer or a write", () => {
    expect(warningCount(component.replace('useState("")', "useState(0)"))).toBe(1);
    expect(warningCount(component.replace('return "Empty"', "return 0"))).toBe(1);
    expect(warningCount(component.replace("formatPageCount(pages)", "() => 0"))).toBe(1);
  });

  it("keeps the warning when the formatter can fall through", () => {
    const source = component.replace('return count + " pages";', "");
    expect(warningCount(source)).toBe(1);
  });

  it("keeps the warning when the setter escapes or the formatter can change", () => {
    const escaped = component.replace(
      "return <section>",
      "receiveWriter(setResultSize); return <section>",
    );
    expect(warningCount(escaped)).toBe(1);
    const replaced = component
      .replace("const formatPageCount", "let formatPageCount")
      .replace("return <section>", "formatPageCount = () => 0; return <section>");
    expect(warningCount(replaced)).toBe(1);
  });

  it("requires a runtime React state hook and rejects hidden writes", () => {
    const erased = component.replace("import { useState }", "import type { useState }");
    expect(warningCount(erased)).toBe(1);
    const custom = component.replace(
      'import { useState } from "react";',
      "const useState = (initial: unknown) => [0, () => initial] as const;",
    );
    expect(warningCount(custom)).toBe(1);
    const hidden = component.replace(
      "return <section>",
      'eval("setResultSize(0)"); return <section>',
    );
    expect(warningCount(hidden)).toBe(1);
  });
});
