import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";

describe("isErasedTypeScriptBinding", () => {
  it.each([
    { code: "namespace candidate {}", expected: true },
    { code: "namespace candidate { interface Marker {} }", expected: true },
    { code: "namespace candidate { export interface Marker {} }", expected: true },
    { code: "namespace candidate { type Marker = string; }", expected: true },
    { code: "namespace candidate { export type Marker = string; }", expected: true },
    {
      code: "namespace candidate { export namespace Nested { export interface Marker {} } }",
      expected: true,
    },
    { code: "namespace candidate { export const marker = 0; }", expected: false },
    { code: "namespace candidate { const marker = 0; }", expected: false },
    { code: "namespace candidate { export function marker() {} }", expected: false },
    { code: "namespace candidate { export class Marker {} }", expected: false },
    { code: "namespace candidate { export enum Marker { Value } }", expected: false },
    {
      code: "namespace candidate { export namespace Nested { export const marker = 0; } }",
      expected: false,
    },
    {
      code: "namespace candidate { type Marker = string; export const marker = 0; }",
      expected: false,
    },
    { code: "namespace candidate {;}", expected: false },
    { code: "namespace candidate { declare const marker: unknown; }", expected: false },
    { code: "namespace candidate { export declare const marker: unknown; }", expected: false },
    { code: "namespace candidate { import Alias = Some.Value; }", expected: true },
    { code: "namespace candidate { export import Alias = Some.Value; }", expected: false },
    { code: "declare const candidate: unknown;", expected: true },
    { code: "declare let candidate: unknown;", expected: true },
    { code: "declare var candidate: unknown;", expected: true },
    { code: "declare class candidate {}", expected: true },
    { code: "export declare const candidate: unknown;", expected: true },
    { code: "interface candidate {}", expected: true },
    { code: "type candidate = unknown;", expected: true },
    { code: 'import type candidate from "provider";', expected: true },
    { code: 'import type * as candidate from "provider";', expected: true },
    { code: 'import { type candidate } from "provider";', expected: true },
    { code: 'import type candidate = require("provider");', expected: true },
    { code: 'import candidate = require("provider");', expected: false },
    { code: "const candidate = 0;", expected: false },
    { code: "let candidate = 0;", expected: false },
    { code: "var candidate = 0;", expected: false },
    { code: "class candidate {}", expected: false },
    { code: "function candidate() {}", expected: false },
    { code: 'import { candidate } from "provider";', expected: false },
    { code: 'import candidate from "provider";', expected: false },
    { code: 'import * as candidate from "provider";', expected: false },
  ])("classifies $code", ({ code, expected }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const symbol = scopes.rootScope.symbols.find((binding) => binding.name === "candidate");
    expect(symbol && isErasedTypeScriptBinding(symbol)).toBe(expected);
  });
});
