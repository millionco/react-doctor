import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasCompleteGlobalReferences } from "./has-complete-global-references.js";
import { parseSourceText } from "./parse-source-file.js";

describe("hasCompleteGlobalReferences", () => {
  it.each([
    ["indexed reads", "globalThis.clearInterval(handle); clearInterval(handle);", true],
    ["indexed writes", "globalThis.clearInterval = () => {};", true],
    [
      "hidden namespace write",
      "try {} catch ({ unused = (globalThis.clearInterval = () => {}) }) {}",
      false,
    ],
    ["hidden cleanup write", "try {} catch ({ unused = (clearInterval = () => {}) }) {}", false],
    ["erased names", "type Notes = ({globalThis}: {globalThis: unknown}) => void;", true],
    ["shadowed names", "const globalThis = {}; consume(globalThis);", true],
    [
      "runtime parameter defaults",
      "class Notes { constructor(public field = globalThis) {} }",
      false,
    ],
  ])("checks %s", (_name, sourceText, expected) => {
    const program = parseSourceText({ filename: "globals.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    const names = new Set(["globalThis", "clearInterval"]);
    expect(hasCompleteGlobalReferences(names, program, scopes)).toBe(expected);
    expect(hasCompleteGlobalReferences(names, program, scopes)).toBe(expected);
  });
});
