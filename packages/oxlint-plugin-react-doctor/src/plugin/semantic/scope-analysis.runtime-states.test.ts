import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { hasRuntimeValueBinding } from "../utils/has-runtime-value-binding.js";
import { isBindingAssignmentTarget } from "../utils/is-binding-assignment-target.js";
import { walkAst } from "../utils/walk-ast.js";
import { analyzeScopes } from "./scope-analysis.js";
import type { ReferenceDescriptor, SymbolDescriptor, SymbolKind } from "./scope-analysis.js";

interface RuntimeStateCase {
  name: string;
  code: string;
  target: string;
  expectedKind: SymbolKind | null;
  expectedAssignmentTargets: number;
}

const cases: RuntimeStateCase[] = [
  {
    name: "let/read",
    code: "let subject=1; interface subject{} consume(subject);",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 0,
  },
  {
    name: "let/interface-before-value",
    code: "interface subject{} let subject=1; consume(subject);",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 0,
  },
  {
    name: "let/nested-alias-shadow",
    code: "let subject=1; function run(){type subject=unknown; consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 0,
  },
  {
    name: "catch/parameter-interface",
    code: "try{throw 1;}catch(subject){interface subject{} consume(subject);}",
    target: "subject",
    expectedKind: "catch-clause-parameter",
    expectedAssignmentTargets: 0,
  },
  {
    name: "catch/destructured-parameter-alias",
    code: "try{throw {subject:1};}catch({subject}){type subject=unknown; consume(subject);}",
    target: "subject",
    expectedKind: "catch-clause-parameter",
    expectedAssignmentTargets: 0,
  },
  {
    name: "catch/shadows-outer-let",
    code: "let subject=1;try{throw 2;}catch(subject){interface subject{} consume(subject);}",
    target: "subject",
    expectedKind: "catch-clause-parameter",
    expectedAssignmentTargets: 0,
  },
  {
    name: "update/postfix",
    code: "let subject=1; function run(){interface subject{} subject++; consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "update/prefix",
    code: "let subject=1; function run(){type subject=unknown; --subject; consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "destructure/object-assignment",
    code: "let subject; function run(){interface subject{} ({value:subject}=source); consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "destructure/array-assignment",
    code: "let subject; function run(){type subject=unknown; [subject]=source; consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "destructure/default-assignment",
    code: "let subject; function run(){interface subject{} ({subject=1}=source); consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "destructure/rest-assignment",
    code: "let subject; function run(){type subject=unknown; [...subject]=source; consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "destructure/let-binding",
    code: "let {subject}=source; interface subject{} consume(subject);",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 0,
  },
  {
    name: "loop/for-of-write",
    code: "let subject; function run(){interface subject{} for(subject of values){} consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "loop/for-in-write",
    code: "let subject; function run(){type subject=unknown; for(subject in values){} consume(subject);}",
    target: "subject",
    expectedKind: "let",
    expectedAssignmentTargets: 1,
  },
  {
    name: "jsx/paired-tags",
    code: "const Subject=()=>null; function View(){interface Subject{} return <Subject></Subject>;}",
    target: "Subject",
    expectedKind: "const",
    expectedAssignmentTargets: 0,
  },
  {
    name: "jsx/member-root",
    code: "const Subject={Child:()=>null}; function View(){type Subject=unknown; return <Subject.Child/>;}",
    target: "Subject",
    expectedKind: "const",
    expectedAssignmentTargets: 0,
  },
  {
    name: "jsx/intrinsic-not-reference",
    code: "interface subject{} const View=()=> <subject/>;",
    target: "subject",
    expectedKind: null,
    expectedAssignmentTargets: 0,
  },
  {
    name: "enum/outer-runtime-under-inner-interface",
    code: "enum subject{One=1};function run(){interface subject{} consume(subject);}",
    target: "subject",
    expectedKind: "ts-enum",
    expectedAssignmentTargets: 0,
  },
  {
    name: "enum/merged-type-namespace-after",
    code: "enum subject{One=1};namespace subject{export interface Marker{}}consume(subject);",
    target: "subject",
    expectedKind: "ts-enum",
    expectedAssignmentTargets: 0,
  },
  {
    name: "enum/merged-type-namespace-before",
    code: "namespace subject{export interface Marker{}}enum subject{One=1};consume(subject);",
    target: "subject",
    expectedKind: "ts-enum",
    expectedAssignmentTargets: 0,
  },
  {
    name: "enum/repeated-runtime-declarations",
    code: "enum subject{One=1};enum subject{Two=2};function run(){type subject=unknown;consume(subject);}",
    target: "subject",
    expectedKind: "ts-enum",
    expectedAssignmentTargets: 0,
  },
  {
    name: "enum/merged-runtime-namespace",
    code: "enum subject{One=1};namespace subject{export const Two=2;}consume(subject);",
    target: "subject",
    expectedKind: "ts-module",
    expectedAssignmentTargets: 0,
  },
];

describe("runtime binding state transitions", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const parsed = parseFixture(scenario.code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const analysis = analyzeScopes(parsed.program);
      const references: ReferenceDescriptor[] = [];
      walkAst(parsed.program, (node) => {
        if (
          (node.type !== "Identifier" && node.type !== "JSXIdentifier") ||
          node.name !== scenario.target
        )
          return;
        const reference = analysis.referenceFor(node);
        if (reference) references.push(reference);
      });
      const resolved = references[0]?.resolvedSymbol ?? null;
      expect(resolved?.kind ?? null).toBe(scenario.expectedKind);
      if (scenario.expectedKind) expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference.resolvedSymbol).toBe(resolved);
        expect(analysis.symbolFor(reference.identifier)).toBe(resolved);
        expect(analysis.isGlobalReference(reference.identifier)).toBe(resolved === null);
        if (resolved) expect(resolved.references).toContain(reference);
      }
      expect(
        references.filter((reference) => isBindingAssignmentTarget(reference.identifier)),
      ).toHaveLength(scenario.expectedAssignmentTargets);
    });
  }

  it("keeps runtime binding caches isolated across A/B/C/A analyses", () => {
    const programs = [
      {
        code: "const subject=1;interface subject{}consume(subject);",
        expectedKind: "const",
        expectedRuntime: true,
      },
      {
        code: "interface subject{}consume(subject);",
        expectedKind: "ts-interface",
        expectedRuntime: false,
      },
      {
        code: "function read(subject){interface subject{}consume(subject);}",
        expectedKind: "parameter",
        expectedRuntime: true,
      },
      {
        code: "const subject=1;interface subject{}consume(subject);",
        expectedKind: "const",
        expectedRuntime: true,
      },
    ];
    const symbols: SymbolDescriptor[] = [];
    const erasedBindings: SymbolDescriptor[] = [];
    for (const scenario of programs) {
      const parsed = parseFixture(scenario.code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const analysis = analyzeScopes(parsed.program);
      const scopes = [analysis.rootScope];
      let erasedBinding: SymbolDescriptor | undefined;
      while (scopes.length) {
        const scope = scopes.pop();
        if (!scope) continue;
        scopes.push(...scope.children);
        erasedBinding ??= scope.symbols.find(
          (symbol) => symbol.name === "subject" && symbol.kind === "ts-interface",
        );
      }
      if (!erasedBinding) throw new Error("Missing erased binding");
      expect(hasRuntimeValueBinding(erasedBinding)).toBe(scenario.expectedRuntime);
      erasedBindings.push(erasedBinding);
      const references: ReferenceDescriptor[] = [];
      walkAst(parsed.program, (node) => {
        if (node.type !== "Identifier" || node.name !== "subject") return;
        const reference = analysis.referenceFor(node);
        if (reference) references.push(reference);
      });
      expect(references).toHaveLength(1);
      const resolved = references[0]?.resolvedSymbol;
      if (!resolved) throw new Error("Missing runtime reference binding");
      expect(resolved.kind).toBe(scenario.expectedKind);
      expect(resolved.references).toContain(references[0]);
      symbols.push(resolved);
    }
    expect(new Set(symbols).size).toBe(programs.length);
    for (const [index, binding] of erasedBindings.entries())
      expect(hasRuntimeValueBinding(binding)).toBe(programs[index]?.expectedRuntime);
    expect(symbols[0]?.references).toHaveLength(1);
  });
});
