import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStaticStringValues } from "./get-jsx-prop-static-string-values.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";

const resolveFirstAttribute = (code: string): ReadonlyArray<string> | null => {
  const { program, errors } = parseFixture(code);
  expect(errors).toEqual([]);
  attachParentReferences(program);
  const scopes = analyzeScopes(program);
  let attribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;
  walkAst(program, (child: EsTreeNode) => {
    if (attribute) return false;
    if (isNodeOfType(child, "JSXAttribute")) attribute = child;
  });
  if (!attribute) throw new Error("fixture has no JSX attribute");
  return getJsxPropStaticStringValues(attribute, scopes);
};

describe("getJsxPropStaticStringValues", () => {
  it("resolves a plain string literal", () => {
    expect(resolveFirstAttribute(`const x = <div role="button" />;`)).toEqual(["button"]);
  });

  it("resolves a string literal in an expression container", () => {
    expect(resolveFirstAttribute(`const x = <div role={"button"} />;`)).toEqual(["button"]);
  });

  it("resolves a static template literal", () => {
    expect(resolveFirstAttribute("const x = <div role={`button`} />;")).toEqual(["button"]);
  });

  it("resolves both branches of a ternary", () => {
    expect(resolveFirstAttribute(`const x = <div role={isOn ? "checkbox" : "radio"} />;`)).toEqual([
      "checkbox",
      "radio",
    ]);
  });

  it("resolves a const-bound identifier", () => {
    expect(
      resolveFirstAttribute(`const buttonRole = "button";\nconst x = <div role={buttonRole} />;`),
    ).toEqual(["button"]);
  });

  it("resolves a const alias chain and a const-bound ternary", () => {
    expect(
      resolveFirstAttribute(
        `const baseRole = "checkbox";\nconst aliasRole = baseRole;\nconst x = <div role={isOn ? aliasRole : "radio"} />;`,
      ),
    ).toEqual(["checkbox", "radio"]);
  });

  it("returns null for a let binding (reassignable)", () => {
    expect(
      resolveFirstAttribute(`let currentRole = "button";\nconst x = <div role={currentRole} />;`),
    ).toBeNull();
  });

  it("returns null for a parameter or import binding", () => {
    expect(
      resolveFirstAttribute(
        `import { roleFromModule } from "./roles";\nconst x = <div role={roleFromModule} />;`,
      ),
    ).toBeNull();
    expect(
      resolveFirstAttribute(`const Chip = ({ chipRole }) => <div role={chipRole} />;`),
    ).toBeNull();
  });

  it("returns null when any ternary branch is dynamic", () => {
    expect(
      resolveFirstAttribute(`const x = <div role={isOn ? "checkbox" : dynamicRole} />;`),
    ).toBeNull();
  });

  it("returns null for a template literal with expressions", () => {
    expect(resolveFirstAttribute("const x = <div role={`role-${suffix}`} />;")).toBeNull();
  });

  it("returns null for non-string literals and missing values", () => {
    expect(resolveFirstAttribute(`const x = <div tabIndex={0} />;`)).toBeNull();
    expect(resolveFirstAttribute(`const x = <div hidden />;`)).toBeNull();
  });
});
