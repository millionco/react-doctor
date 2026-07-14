import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  getJsxPropExhaustiveStaticStringValues,
  getJsxPropStaticStringValues,
} from "./get-jsx-prop-static-string-values.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";

const DEEP_ALIAS_CHAIN_LENGTH = 50_000;

const resolveFirstAttribute = (
  code: string,
  shouldResolveExhaustively = false,
): ReadonlyArray<string> | null => {
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
  return shouldResolveExhaustively
    ? getJsxPropExhaustiveStaticStringValues(attribute, scopes)
    : getJsxPropStaticStringValues(attribute, scopes);
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

  it("resolves every branch of a nested ternary", () => {
    expect(
      resolveFirstAttribute(`const x = <div role={a ? "button" : b ? "link" : "menu"} />;`),
    ).toEqual(["button", "link", "menu"]);
  });

  it("resolves only the reachable branch of a statically known ternary", () => {
    expect(
      resolveFirstAttribute(`const x = <div role={true ? "button" : dynamicRole} />;`, true),
    ).toEqual(["button"]);
    expect(
      resolveFirstAttribute(`const x = <div role={false ? dynamicRole : "link"} />;`, true),
    ).toEqual(["link"]);
  });

  it("keeps the default mode conservative across a statically unreachable dynamic branch", () => {
    expect(
      resolveFirstAttribute(`const x = <div role={true ? "button" : dynamicRole} />;`),
    ).toBeNull();
  });

  it("resolves long acyclic const chains in exhaustive mode", () => {
    expect(
      resolveFirstAttribute(
        `const a = "button"; const b = a; const c = b; const d = c; const e = d; const f = e;\nconst x = <div role={f} />;`,
        true,
      ),
    ).toEqual(["button"]);
  });

  it("keeps the default mode's four-alias resolution limit", () => {
    expect(
      resolveFirstAttribute(
        `const a = "button"; const b = a; const c = b; const d = c;\nconst x = <div role={d} />;`,
      ),
    ).toEqual(["button"]);
    expect(
      resolveFirstAttribute(
        `const a = "button"; const b = a; const c = b; const d = c; const e = d;\nconst x = <div role={e} />;`,
      ),
    ).toBeNull();
  });

  it("resolves a deep acyclic const chain without overflowing the call stack", () => {
    const declarations = Array.from({ length: DEEP_ALIAS_CHAIN_LENGTH }, (_, declarationIndex) =>
      declarationIndex === 0
        ? `const type0 = "button";`
        : `const type${declarationIndex} = type${declarationIndex - 1};`,
    ).join("\n");
    expect(
      resolveFirstAttribute(
        `${declarations}\nconst x = <div role={type${DEEP_ALIAS_CHAIN_LENGTH - 1}} />;`,
        true,
      ),
    ).toEqual(["button"]);
  });

  it("allows sibling ternary branches to resolve the same const alias", () => {
    expect(
      resolveFirstAttribute(
        `const sharedRole = "button";\nconst x = <div role={condition ? sharedRole : sharedRole} />;`,
        true,
      ),
    ).toEqual(["button", "button"]);
  });

  it("returns null for cyclic const aliases", () => {
    expect(
      resolveFirstAttribute(
        `const firstRole = secondRole; const secondRole = firstRole;\nconst x = <div role={firstRole} />;`,
        true,
      ),
    ).toBeNull();
  });

  it("resolves a parenthesized `as const` string", () => {
    expect(resolveFirstAttribute(`const x = <div role={("button" as const)} />;`)).toEqual([
      "button",
    ]);
  });

  it("returns null for a const bound via object destructuring (source is not the value)", () => {
    expect(
      resolveFirstAttribute(
        `const config = "button";\nconst { role } = config;\nconst x = <div role={role} />;`,
      ),
    ).toBeNull();
  });

  it("returns null for a destructuring default (the source may override it)", () => {
    expect(
      resolveFirstAttribute(`const { role = "button" } = config;\nconst x = <div role={role} />;`),
    ).toBeNull();
  });

  it("returns null for a const bound via array destructuring", () => {
    expect(
      resolveFirstAttribute(
        `const roles = "button";\nconst [role] = roles;\nconst x = <div role={role} />;`,
      ),
    ).toBeNull();
  });

  it("returns null for a const initialized from a function call", () => {
    expect(
      resolveFirstAttribute(`const role = resolveRole();\nconst x = <div role={role} />;`),
    ).toBeNull();
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
