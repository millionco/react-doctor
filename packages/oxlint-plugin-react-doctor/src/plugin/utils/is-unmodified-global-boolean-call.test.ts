import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getBooleanCallArgument } from "./get-boolean-call-argument.js";
import { isUnmodifiedGlobalBooleanCall } from "./is-unmodified-global-boolean-call.js";
import { walkAst } from "./walk-ast.js";

describe("unmodified native Boolean call proof", () => {
  it.each([
    { code: "Boolean(value)", expected: true },
    { code: "globalThis.Boolean(value)", expected: true },
    { code: "const Boolean = () => true; Boolean(value)", expected: false },
    { code: "Boolean = () => true; Boolean(value)", expected: false },
    { code: "globalThis.Boolean = () => true; Boolean(value)", expected: false },
    { code: "({ value: Boolean } = source); Boolean(value)", expected: false },
    { code: "({ value: globalThis.Boolean } = source); Boolean(value)", expected: false },
    { code: "const host = globalThis; host.Boolean = () => true; Boolean(value)", expected: false },
    { code: "globalThis = { Boolean: () => true }; globalThis.Boolean(value)", expected: false },
  ])("keeps native proof separate from opaque call tracking: $code", ({ code, expected }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const proofs: boolean[] = [];
    walkAst(parsed.program, (node) => {
      if (getBooleanCallArgument(node)) {
        proofs.push(isUnmodifiedGlobalBooleanCall({ node, scopes }));
      }
    });
    expect(proofs).toEqual([expected]);
  });
});
