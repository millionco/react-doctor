import { describe, expect, it } from "vite-plus/test";
import { AST_CHECKS } from "../src/checks/index.js";
import { deslopNestedTernary } from "../src/checks/deslop-nested-ternary.js";
import { tsBanTsComment } from "../src/checks/ts-ban-ts-comment.js";
import { tsNoExplicitAny } from "../src/checks/ts-no-explicit-any.js";
import { tsNoNonNullAssertion } from "../src/checks/ts-no-non-null-assertion.js";
import { tsNoTypeAssertion } from "../src/checks/ts-no-type-assertion.js";
import { vercelBooleanPropSoup } from "../src/checks/vercel-boolean-prop-soup.js";
import { vercelRenderProp } from "../src/checks/vercel-render-prop.js";
import { parseSourceText } from "../src/utils/parse-source-file.js";
import type { AstCheck, ParsedSourceFile } from "../src/types/index.js";

const parse = (sourceText: string, filePath = "src/sample.tsx"): ParsedSourceFile => {
  const parsed = parseSourceText(filePath, sourceText);
  if (!parsed) throw new Error(`fixture failed to parse: ${filePath}`);
  return parsed;
};

const ruleIdsOf = (check: AstCheck, sourceText: string, filePath?: string): string[] =>
  check(parse(sourceText, filePath)).map((finding) => finding.ruleId);

describe("ts-no-explicit-any", () => {
  it("flags explicit any annotations", () => {
    const ids = ruleIdsOf(tsNoExplicitAny, "const value: any = 1;\nfunction f(x: any) { return x; }\n");
    expect(ids.filter((id) => id === "ts/no-explicit-any")).toHaveLength(2);
  });
  it("ignores well-typed code", () => {
    expect(tsNoExplicitAny(parse("const value: number = 1;\n"))).toHaveLength(0);
  });
});

describe("ts-no-non-null-assertion", () => {
  it("flags the non-null operator", () => {
    expect(ruleIdsOf(tsNoNonNullAssertion, "const a = b!.c;\n")).toContain("ts/no-non-null-assertion");
  });
});

describe("ts-no-type-assertion", () => {
  it("flags `as` casts but not `as const`", () => {
    const cast = ruleIdsOf(tsNoTypeAssertion, "const a = x as string;\n");
    expect(cast).toContain("ts/no-type-assertion");
    expect(tsNoTypeAssertion(parse("const a = [1, 2] as const;\n"))).toHaveLength(0);
  });
});

describe("ts-ban-ts-comment", () => {
  it("flags suppression directives as errors", () => {
    const findings = tsBanTsComment(parse("// @ts-ignore\nconst a: number = 'x' as never;\n"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
  });
  it("ignores ordinary comments", () => {
    expect(tsBanTsComment(parse("// a normal note\nconst a = 1;\n"))).toHaveLength(0);
  });
});

describe("vercel-boolean-prop-soup", () => {
  it("flags a *Props type with many boolean flags", () => {
    const source = [
      "interface ButtonProps {",
      "  isPrimary: boolean;",
      "  isDisabled: boolean;",
      "  isLoading: boolean;",
      "  isRounded: boolean;",
      "}",
      "",
    ].join("\n");
    expect(ruleIdsOf(vercelBooleanPropSoup, source, "src/button.ts")).toContain(
      "vercel/architecture-boolean-prop-soup",
    );
  });
  it("ignores a props type with only a couple of booleans", () => {
    const source = "interface ButtonProps {\n  isPrimary: boolean;\n  label: string;\n}\n";
    expect(vercelBooleanPropSoup(parse(source, "src/button.ts"))).toHaveLength(0);
  });
});

describe("vercel-render-prop", () => {
  it("flags function-valued render props", () => {
    const source = "interface ListProps {\n  renderItem: (value: string) => unknown;\n}\n";
    expect(ruleIdsOf(vercelRenderProp, source, "src/list.ts")).toContain("vercel/patterns-render-prop");
  });
  it("ignores non-render function props", () => {
    const source = "interface ListProps {\n  onSelect: (value: string) => void;\n}\n";
    expect(vercelRenderProp(parse(source, "src/list.ts"))).toHaveLength(0);
  });
});

describe("deslop-nested-ternary", () => {
  it("flags a nested ternary exactly once per chain", () => {
    const findings = deslopNestedTernary(parse("const x = a ? 1 : b ? 2 : c ? 3 : 4;\n", "src/t.ts"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("deslop/nested-ternary");
  });
  it("ignores a single ternary", () => {
    expect(deslopNestedTernary(parse("const x = a ? 1 : 2;\n", "src/t.ts"))).toHaveLength(0);
  });
});

describe("AST_CHECKS registry", () => {
  it("runs every check and aggregates findings on a sloppy file", () => {
    const source = [
      "// @ts-nocheck",
      "interface WidgetProps { a: boolean; b: boolean; c: boolean; d: boolean }",
      "const value: any = (raw as string)!;",
      "const label = x ? 'a' : y ? 'b' : 'c';",
      "",
    ].join("\n");
    const file = parse(source, "src/widget.tsx");
    const ruleIds = AST_CHECKS.flatMap((check) => check(file)).map((finding) => finding.ruleId);
    expect(ruleIds).toContain("ts/ban-ts-comment");
    expect(ruleIds).toContain("ts/no-explicit-any");
    expect(ruleIds).toContain("ts/no-type-assertion");
    expect(ruleIds).toContain("ts/no-non-null-assertion");
    expect(ruleIds).toContain("vercel/architecture-boolean-prop-soup");
    expect(ruleIds).toContain("deslop/nested-ternary");
  });
});
