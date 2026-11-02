import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isErasedTypeScriptNamespace } from "./is-erased-typescript-namespace.js";

describe("dotted TypeScript namespace erasure", () => {
  it.each([
    { code: "namespace candidate.Nested {}", expected: true },
    { code: "namespace candidate.Nested { export interface Marker {} }", expected: true },
    { code: "namespace candidate.Nested { export type Marker = string; }", expected: true },
    { code: "namespace candidate.Nested { export const marker = 0; }", expected: false },
  ])("classifies $code", ({ code, expected }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected namespace program");
    const namespace = parsed.program.body[0];
    expect(namespace && isErasedTypeScriptNamespace(namespace)).toBe(expected);
  });
});
