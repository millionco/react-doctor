import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { hasTypedDisplayNameAssignment } from "./utils/has-typed-display-name-assignment.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";
import {
  TYPED_DISPLAY_NAME_PROOF_COUNTS,
  TYPED_DISPLAY_NAME_MAX_PROGRAM_READS,
  TYPED_DISPLAY_NAME_MAX_BODY_PASSES,
  TYPED_DISPLAY_NAME_MAX_AST_PASSES,
} from "../../../test-utils/typed-display-name-proof/constants.js";

interface TypedDisplayNameProofCounters {
  programBodyReads: number;
  bodyElementReads: number;
  astTypeReads: number;
}

interface TypedDisplayNameProofMeasurement {
  parseErrors: ReturnType<typeof parseFixture>["errors"];
  admitted: boolean[];
  counters: TypedDisplayNameProofCounters;
  statementCount: number;
  astNodes: number;
}

const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };
const makeSource = (shape: string, count: number, rejected: boolean): string =>
  `import {forwardRef}from 'react';interface DisplayTarget{displayName?:string;}\n${Array.from({ length: count }, (_, index) => `export const Preview${index}=${shape === "typed-initializer-and-receiver" ? `((forwardRef((props,ref)=><div ref={ref}/>) as unknown) as DisplayTarget)` : `forwardRef((props,ref)=><div ref={ref}/>)`};\n${shape === "typed-initializer-and-receiver" ? `((Preview${index}! satisfies unknown) as DisplayTarget)` : `(Preview${index} as DisplayTarget)`}.displayName='Preview${index}';`).join("\n")}\n${rejected ? 'eval("void 0");' : ""}`;

const measureTypedDisplayNameProof = (source: string): TypedDisplayNameProofMeasurement => {
  const parsed = parseFixture(source);
  if (!isNodeOfType(parsed.program, "Program")) throw Error("Expected Program");
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const nodes: EsTreeNode[] = [],
    calls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "forwardRef"
    )
      calls.push(node);
  });
  const counters = { programBodyReads: 0, bodyElementReads: 0, astTypeReads: 0 };
  const statementCount = parsed.program.body.length;
  const body = new Proxy(parsed.program.body, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) counters.bodyElementReads++;
      return Reflect.get(target, property, receiver);
    },
  });
  Object.defineProperty(parsed.program, "body", {
    configurable: true,
    enumerable: true,
    get() {
      counters.programBodyReads++;
      return body;
    },
  });
  for (const node of nodes) {
    const type = node.type;
    Object.defineProperty(node, "type", {
      configurable: true,
      enumerable: true,
      get() {
        counters.astTypeReads++;
        return type;
      },
    });
  }
  const admitted = calls.map((node) => hasTypedDisplayNameAssignment({ node, scopes }));
  return {
    parseErrors: parsed.errors,
    admitted,
    counters: { ...counters },
    statementCount,
    astNodes: nodes.length,
  };
};

describe("typed display-name proof work", () => {
  for (const shape of ["typed-receiver", "typed-initializer-and-receiver"])
    for (const count of TYPED_DISPLAY_NAME_PROOF_COUNTS) {
      it(`${shape} ${count}`, () => {
        const code = makeSource(shape, count, false),
          rejected = makeSource(shape, count, true);
        for (const [source, expected] of [
          [code, true],
          [rejected, false],
        ] satisfies ReadonlyArray<readonly [string, boolean]>) {
          const proof = measureTypedDisplayNameProof(source);
          expect(proof.parseErrors).toEqual([]);
          expect(proof.admitted).toHaveLength(count);
          expect(proof.admitted.every((value) => value === expected)).toBe(true);
          expect(proof.counters.programBodyReads).toBeLessThanOrEqual(
            TYPED_DISPLAY_NAME_MAX_PROGRAM_READS,
          );
          expect(proof.counters.bodyElementReads).toBeLessThanOrEqual(
            proof.statementCount * TYPED_DISPLAY_NAME_MAX_BODY_PASSES,
          );
          expect(proof.counters.astTypeReads).toBeLessThanOrEqual(
            proof.astNodes * TYPED_DISPLAY_NAME_MAX_AST_PASSES,
          );
        }
        const actual = runRule(displayName, code, { settings }),
          control = runRule(displayName, rejected, { settings });
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(control.parseErrors).toEqual([]);
        expect(control.diagnostics).toHaveLength(count);
      });
    }
});

const TYPED_DISPLAY_NAME_CONTEXT_CASES = [
  {
    name: "current-adjacency-and-reference",
    code: "import {forwardRef}from'react';interface DisplayTarget{displayName?:string;}\nexport const Safe=forwardRef((props,ref)=><div ref={ref}/>);(Safe as DisplayTarget).displayName='Safe';\nexport const Delayed=forwardRef((props,ref)=><div ref={ref}/>);consume(Delayed);(Delayed as DisplayTarget).displayName='Delayed';\nexport const Escaped=forwardRef((props,ref)=><div ref={ref}/>);(Escaped as DisplayTarget).displayName='Escaped';consume(Escaped);\n",
    expected: [true, false, false],
    diagnostics: [
      {
        column: 21,
        line: 3,
        message:
          "This component shows up as Anonymous in React DevTools because it has no `displayName`.",
        nodeType: "CallExpression",
      },
      {
        column: 21,
        line: 4,
        message:
          "This component shows up as Anonymous in React DevTools because it has no `displayName`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "current-typed-wrapper-frontier",
    code: "import {forwardRef}from'react';interface DisplayTarget{displayName?:string;}\nexport const Safe=forwardRef((props,ref)=><div ref={ref}/>);(Safe as DisplayTarget).displayName='Safe';\nexport const Instantiated=(forwardRef((props,ref)=><div ref={ref}/>))<unknown>;(Instantiated as DisplayTarget).displayName='Instantiated';\n",
    expected: [true, false],
    diagnostics: [
      {
        column: 27,
        line: 3,
        message:
          "This component shows up as Anonymous in React DevTools because it has no `displayName`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("typed display-name selected context", () => {
  it.each(TYPED_DISPLAY_NAME_CONTEXT_CASES)("$name", ({ code, expected, diagnostics }) => {
    const parsed = parseFixture(code);
    attachParentReferences(parsed.program);
    const calls: EsTreeNodeOfType<"CallExpression">[] = [];
    walkAst(parsed.program, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "forwardRef"
      )
        calls.push(node);
    });
    expect(parsed.errors).toEqual([]);
    for (const reverse of [false, true]) {
      const scopes = analyzeScopes(parsed.program),
        order = expected.map((_, index) => index);
      if (reverse) order.reverse();
      for (const selected of [...order, ...order, ...order.toReversed()]) {
        const node = calls[selected];
        if (!node) throw Error("Expected component call");
        expect(hasTypedDisplayNameAssignment({ node, scopes })).toBe(expected[selected]);
      }
    }
    const actual = runRule(displayName, code, { settings, includeLocations: true });
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual(diagnostics);
  });
});
