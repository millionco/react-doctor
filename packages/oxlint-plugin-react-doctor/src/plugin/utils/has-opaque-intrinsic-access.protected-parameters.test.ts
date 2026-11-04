import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasOpaqueIntrinsicAccess } from "./has-opaque-intrinsic-access.js";
import { parseSourceText } from "./parse-source-file.js";

const PROTECTED_NATIVE_NAMES = new Set(["Object", "Array", "globalThis"]);

describe("protected intrinsic proof parameter expressions", () => {
  it.each([
    "function change(unused = (Object.assign = replacement)) { var Object; }",
    "const NativeObject = Object; function change(unused = (NativeObject.assign = replacement)) { var NativeObject; }",
    "const Host = globalThis; function change(unused = (Host.Object.assign = replacement)) { var Host; }",
    "function change({ unused = (Object.assign = replacement) } = {}) { var Object; }",
    "function change(unused = () => (Object.assign = replacement)) { var Object; }",
  ])("keeps default and protected caches separate: %s", (sourceText) => {
    const program = parseSourceText({ filename: "parameters.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: PROTECTED_NATIVE_NAMES }),
    ).toBe(true);
    expect(hasOpaqueIntrinsicAccess(program, scopes)).toBe(false);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: new Set(["Array"]) }),
    ).toBe(true);
  });

  it.each([
    "function read(value = 0) { return value; }",
    "function read(value = () => 0) { return value; }",
    "type Notes = ({ Object }: { Object: unknown }) => void; function read(value = 0) { return value; }",
  ])("preserves closed defaults and erased references: %s", (sourceText) => {
    const program = parseSourceText({ filename: "parameters.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    expect(
      hasOpaqueIntrinsicAccess(program, scopes, { protectedGlobalNames: PROTECTED_NATIVE_NAMES }),
    ).toBe(false);
  });
});
