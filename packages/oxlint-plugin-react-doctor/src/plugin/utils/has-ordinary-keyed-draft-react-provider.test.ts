import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasOrdinaryKeyedDraftReactProvider } from "./has-ordinary-keyed-draft-react-provider.js";
import { parseSourceText } from "./parse-source-file.js";

const sourceText = 'import {useState} from "react"; const read = () => useState(0);';

describe("hasOrdinaryKeyedDraftReactProvider", () => {
  it("binds cached renderer evidence to the source text containing its pragmas", () => {
    const program = parseSourceText({ filename: "provider.tsx", sourceText });
    if (!program || program.type !== "Program") throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, sourceText)).toBe(true);
    const opaqueSourceText = "/** @jsxImportSource preact */\n" + sourceText;
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, opaqueSourceText)).toBe(false);
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, opaqueSourceText)).toBe(false);
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, sourceText)).toBe(true);
  });

  it("checks renderer settings independently of cached program facts", () => {
    const program = parseSourceText({ filename: "provider.tsx", sourceText });
    if (!program || program.type !== "Program") throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, sourceText)).toBe(true);
    expect(
      hasOrdinaryKeyedDraftReactProvider(program, scopes, sourceText, {
        "react-doctor": { preactVersion: "10.0.0" },
      }),
    ).toBe(false);
    expect(hasOrdinaryKeyedDraftReactProvider(program, scopes, sourceText)).toBe(true);
  });
});
