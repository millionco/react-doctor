import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";
import { walkAst } from "./walk-ast.js";

const resolveFirstOpeningElementName = (source: string): string => {
  const parsed = parseFixture(source);
  attachParentReferences(parsed.program);
  let openingElement: EsTreeNodeOfType<"JSXOpeningElement"> | null = null;
  walkAst(parsed.program, (node) => {
    if (!openingElement && isNodeOfType(node, "JSXOpeningElement")) openingElement = node;
  });
  if (!openingElement) throw new Error("Expected a JSX opening element");
  return resolveJsxElementType(openingElement);
};

describe("resolveJsxElementType", () => {
  it("resolves exact local const string bindings through TypeScript wrappers", () => {
    expect(
      resolveFirstOpeningElementName(
        'const ButtonTag = "button" as const; const rendered = <ButtonTag />;',
      ),
    ).toBe("button");
    expect(
      resolveFirstOpeningElementName(
        'const AnchorTag = ("a" satisfies string); const rendered = <AnchorTag />;',
      ),
    ).toBe("a");
  });

  it("keeps dynamic and non-const bindings opaque", () => {
    expect(
      resolveFirstOpeningElementName(
        'const DynamicTag = condition ? "button" : "a"; const rendered = <DynamicTag />;',
      ),
    ).toBe("DynamicTag");
    expect(
      resolveFirstOpeningElementName('let ButtonTag = "button"; const rendered = <ButtonTag />;'),
    ).toBe("ButtonTag");
  });

  it("keeps lowercase JSX identifiers intrinsic", () => {
    expect(
      resolveFirstOpeningElementName(
        'const button = "a" as const; const rendered = <button href="/account" />;',
      ),
    ).toBe("button");
  });

  it("keeps imports, components, and member expressions opaque", () => {
    expect(
      resolveFirstOpeningElementName(
        'import { ButtonTag } from "./button"; const rendered = <ButtonTag />;',
      ),
    ).toBe("ButtonTag");
    expect(
      resolveFirstOpeningElementName(
        "const rendered = <ButtonTag />; const ButtonTag = () => <span />;",
      ),
    ).toBe("ButtonTag");
    expect(resolveFirstOpeningElementName("const rendered = <Widgets.Button />;")).toBe(
      "Widgets.Button",
    );
  });
});
