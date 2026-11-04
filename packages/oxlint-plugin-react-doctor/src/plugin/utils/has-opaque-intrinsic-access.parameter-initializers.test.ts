import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasOpaqueIntrinsicAccess } from "./has-opaque-intrinsic-access.js";
import { parseSourceText } from "./parse-source-file.js";

describe("opaque intrinsic parameter environments", () => {
  it.each([
    `function change(value = (Array.isArray = () => false)) { var Array; }`,
    `const NativeArray = Array; function change(value = (NativeArray.isArray = () => false)) { var NativeArray; }`,
    `const Host = globalThis; function change(value = (Host.Array.isArray = () => false)) { var Host; }`,
    `const NativeArray = Array; function change(value = () => (NativeArray.isArray = () => false)) { var NativeArray; }`,
  ])("separates strict-default and protected proof caches for %s", (sourceText) => {
    const program = parseSourceText({ filename: "parameter-environment.ts", sourceText });
    if (!program) throw new Error("Expected a parseable parameter fixture");
    const scopes = analyzeScopes(program);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, {
        protectedGlobalNames: new Set(["Array", "Object", "globalThis"]),
      }),
    ).toBe(true);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
  });

  it.each([
    `document.defaultView.Array.isArray = () => false;`,
    `const { Array: NativeArray } = receiveHost(); NativeArray.isArray = () => false;`,
  ])("separates protected namespace capability caches for %s", (sourceText) => {
    const program = parseSourceText({ filename: "host-namespace.ts", sourceText });
    if (!program) throw new Error("Expected a parseable namespace fixture");
    const scopes = analyzeScopes(program);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: new Set(["Object"]) }),
    ).toBe(false);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: new Set(["Array"]) }),
    ).toBe(true);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
  });

  it("accepts literal defaults and erased type positions", () => {
    const program = parseSourceText({
      filename: "literal-defaults.ts",
      sourceText: `function harmless(value: Array<string> = []) { return value; }`,
    });
    if (!program) throw new Error("Expected a parseable literal default");
    expect(
      hasOpaqueIntrinsicAccess(program, analyzeScopes(program), {
        protectedGlobalNames: new Set(["Array"]),
      }),
    ).toBe(false);
  });

  it("retains strict abstention for computed binding keys", () => {
    const program = parseSourceText({
      filename: "computed-parameter.ts",
      sourceText: `const NativeObject = Object; function change({ [NativeObject.assign = () => /x/]: value }) { var NativeObject; }`,
    });
    if (!program) throw new Error("Expected a parseable computed parameter");
    const scopes = analyzeScopes(program);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(true);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: new Set(["Object"]) }),
    ).toBe(true);
  });
});
