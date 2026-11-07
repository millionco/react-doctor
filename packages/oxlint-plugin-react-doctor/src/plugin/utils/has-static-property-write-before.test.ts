import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import {
  hasPossibleStaticPropertyMutationOrEscape,
  hasPossibleStaticPropertyMutationOrEscapeBefore,
} from "./has-static-property-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("static property mutation and escape", () => {
  it.each([
    {
      name: "a typed property read",
      code: "const provider = {}; void (provider as typeof provider).method; void 0;",
      expectedEscape: false,
      expectedEscapeBefore: false,
    },
    {
      name: "a typed method call",
      code: "const provider = {}; (provider as typeof provider).method(); void 0;",
      expectedEscape: false,
      expectedEscapeBefore: true,
    },
    {
      name: "a typed object passed to an unknown function",
      code: "const provider = {}; configure(provider as typeof provider); void 0;",
      expectedEscape: true,
      expectedEscapeBefore: true,
    },
    {
      name: "a typed property write",
      code: "const provider = {}; (provider as typeof provider).method = replacement; void 0;",
      expectedEscape: true,
      expectedEscapeBefore: true,
    },
    {
      name: "a typed object used as another object's computed key",
      code: "const provider = {}; void other[provider as typeof provider]; void 0;",
      expectedEscape: true,
      expectedEscapeBefore: true,
    },
  ])("classifies $name", ({ code, expectedEscape, expectedEscapeBefore }) => {
    const parsedFixture = parseFixture(code);
    expect(parsedFixture.errors).toEqual([]);
    attachParentReferences(parsedFixture.program);
    const scopeAnalysis = analyzeScopes(parsedFixture.program);
    const providerSymbol = scopeAnalysis.rootScope.symbols.find(
      (symbol) => symbol.name === "provider",
    );
    const referencePoint = isNodeOfType(parsedFixture.program, "Program")
      ? parsedFixture.program.body.at(-1)
      : null;
    if (!providerSymbol || !referencePoint) throw new Error("Missing provider or reference point");

    expect(
      hasPossibleStaticPropertyMutationOrEscape(
        providerSymbol.bindingIdentifier,
        "method",
        scopeAnalysis,
      ),
    ).toBe(expectedEscape);
    expect(
      hasPossibleStaticPropertyMutationOrEscapeBefore(
        providerSymbol.bindingIdentifier,
        "method",
        referencePoint,
        scopeAnalysis,
      ),
    ).toBe(expectedEscapeBefore);
  });
});
