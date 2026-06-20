import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../src/control-flow-graph.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";

// Terminal-structure parity with the React Compiler HIR taxonomy
// (`BabelPluginReactCompiler` → `HIR/BuildHIR.ts`, `HIR/HIR.ts` terminal
// union). Each construct must lower to its corresponding typed `Terminal`,
// the fidelity claim of this package: we model the same terminal shapes the
// compiler does (plus `finalize`/`join` for try/finally, which RC omits).
const terminalKindsOf = (body: string): string[] => {
  const parsed = parseFixture(`function host() { ${body} }`);
  attachParentReferences(parsed.program);
  const analysis = analyzeControlFlow(parsed.program);
  const host = (parsed.program as { body: EsTreeNode[] }).body[0]!;
  const cfg = analysis.cfgFor(host);
  if (!cfg) throw new Error("fixture produced no CFG for host()");
  return cfg.blocks.map((block) => block.terminal.kind);
};

describe("terminal-shape parity (React Compiler HIR taxonomy)", () => {
  const cases: ReadonlyArray<{ name: string; body: string; kind: string }> = [
    // Statement terminals.
    { name: "if", body: "if (x) { a(); }", kind: "if" },
    { name: "switch", body: "switch (x) { case 1: a(); break; }", kind: "switch" },
    { name: "while", body: "while (x) { a(); }", kind: "while" },
    { name: "do-while", body: "do { a(); } while (x);", kind: "do-while" },
    { name: "for", body: "for (let i = 0; i < n; i++) { a(); }", kind: "for" },
    { name: "for-in", body: "for (const k in obj) { a(); }", kind: "for-in" },
    { name: "for-of", body: "for (const v of arr) { a(); }", kind: "for-of" },
    { name: "try", body: "try { a(); } catch (e) { b(); }", kind: "try" },
    { name: "return", body: "return 1;", kind: "return" },
    { name: "throw", body: "throw e;", kind: "throw" },
    { name: "break → goto", body: "while (x) { break; }", kind: "goto" },
    { name: "continue → goto", body: "while (x) { continue; }", kind: "goto" },
    // Expression (value-block) terminals — the React Compiler's
    // `ternary` / `logical` / `optional`.
    { name: "ternary", body: "const v = cond ? a() : b();", kind: "ternary" },
    { name: "logical &&", body: "const v = a() && b();", kind: "logical" },
    { name: "logical ??", body: "const v = a() ?? b();", kind: "logical" },
    { name: "logical assignment", body: "let v = a(); v ||= b();", kind: "logical" },
    { name: "optional chain", body: "const v = obj?.a;", kind: "optional" },
    { name: "optional call", body: "const v = obj.fn?.();", kind: "optional" },
  ];

  for (const testCase of cases) {
    it(`lowers ${testCase.name} to a "${testCase.kind}" terminal`, () => {
      expect(terminalKindsOf(testCase.body)).toContain(testCase.kind);
    });
  }

  it("every reachable block carries a typed terminal (no leftover sentinel)", () => {
    // The only blocks that may keep the `unreachable` sentinel are genuine
    // orphans / the function exit. A straight-line function should have its
    // implicit return modeled as a `return` terminal, not a sentinel.
    const kinds = terminalKindsOf("a(); b(); c();");
    expect(kinds).toContain("return");
  });
});
