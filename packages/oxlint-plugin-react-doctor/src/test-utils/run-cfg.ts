import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../plugin/semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../plugin/semantic/control-flow-graph.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import { isAstNode } from "../plugin/utils/is-ast-node.js";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";

// A control-flow node addressed by the name of a marker call in the
// fixture, e.g. `acquire()` is `"acquire"`. When a fixture calls the same
// marker more than once, disambiguate with a 1-based occurrence suffix:
// `"setState#2"` is the second `setState(...)` in source order. The callee
// may be an identifier (`acquire()`) or a member call (`ref.subscribe()`,
// addressed as `"subscribe"`), so fixtures can read like real React code.
export type CfgMarkerSpec = string;

export interface CfgFixture {
  readonly analysis: ControlFlowAnalysis;
  readonly program: EsTreeNode;
  // Resolves a marker spec to its CallExpression node, throwing a loud,
  // self-documenting error on a typo or wrong occurrence count so a stale
  // fixture can never silently assert nothing.
  readonly resolve: (spec: CfgMarkerSpec) => EsTreeNode;
}

const calleeNameOf = (callExpression: EsTreeNode): string | null => {
  const callee = (callExpression as { callee: EsTreeNode }).callee;
  if (callee.type === "Identifier") return (callee as { name: string }).name;
  if (callee.type === "MemberExpression") {
    const property = (callee as { property: EsTreeNode }).property;
    if (property.type === "Identifier") return (property as { name: string }).name;
  }
  return null;
};

const collectCallMarkers = (root: EsTreeNode, markerName: string): EsTreeNode[] => {
  const matches: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (node.type === "CallExpression" && calleeNameOf(node) === markerName) {
      matches.push(node);
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return matches;
};

const parseMarkerSpec = (spec: CfgMarkerSpec): { name: string; occurrence: number } => {
  const hashIndex = spec.lastIndexOf("#");
  if (hashIndex === -1) return { name: spec, occurrence: 1 };
  const occurrence = Number(spec.slice(hashIndex + 1));
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`Invalid CFG marker occurrence in "${spec}" (expected "name#<1-based>")`);
  }
  return { name: spec.slice(0, hashIndex), occurrence };
};

export const analyzeCfgFixture = (code: string): CfgFixture => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(
      `CFG fixture failed to parse: ${parsed.errors.map((e) => e.message).join("; ")}`,
    );
  }
  attachParentReferences(parsed.program);
  const analysis = analyzeControlFlow(parsed.program);
  const resolve = (spec: CfgMarkerSpec): EsTreeNode => {
    const { name, occurrence } = parseMarkerSpec(spec);
    const matches = collectCallMarkers(parsed.program, name);
    const node = matches[occurrence - 1];
    if (!node) {
      throw new Error(
        `CFG marker "${spec}" not found — fixture has ${matches.length} call(s) to "${name}()"`,
      );
    }
    return node;
  };
  return { analysis, program: parsed.program, resolve };
};

// Compare booleans through a labeled string so a failure renders as
// `Expected: "postDominates(cleanup, acquire) → true"` / `Received: … → false`
// regardless of the test runner's `expect` message support.
const assertLabeled = (label: string, actual: boolean, expected: boolean): void => {
  expect(`${label} → ${actual}`).toBe(`${label} → ${expected}`);
};

type MarkerPair = readonly [from: CfgMarkerSpec, to: CfgMarkerSpec, expected: boolean];

export interface CfgCase {
  readonly name: string;
  readonly code: string;
  // Unary primitives, keyed by marker spec.
  readonly unconditional?: Readonly<Record<CfgMarkerSpec, boolean>>;
  readonly unreachable?: Readonly<Record<CfgMarkerSpec, boolean>>;
  readonly insideLoop?: Readonly<Record<CfgMarkerSpec, boolean>>;
  // Pairwise primitives: [a, b, expected].
  // dominates(a, b): a runs on every path that reaches b.
  readonly dominates?: ReadonlyArray<MarkerPair>;
  // postDominates(b, a): b runs on every path from a to the function exit.
  readonly postDominates?: ReadonlyArray<MarkerPair>;
  // reachable(from, to): some path flows from `from` to `to`.
  readonly reachable?: ReadonlyArray<MarkerPair>;
}

// Declarative, adversarial-by-construction CFG regression runner. Each case
// pins the exact control-flow facts a rule depends on; pair a should-flag
// fixture with its must-stay-quiet twin so the false-positive boundary is
// itself a locked regression.
export const runCfgCases = (suiteName: string, cases: ReadonlyArray<CfgCase>): void => {
  describe(suiteName, () => {
    for (const testCase of cases) {
      it(testCase.name, () => {
        const { analysis, resolve } = analyzeCfgFixture(testCase.code);

        for (const [spec, expected] of Object.entries(testCase.unconditional ?? {})) {
          assertLabeled(
            `isUnconditionalFromEntry(${spec})`,
            analysis.isUnconditionalFromEntry(resolve(spec)),
            expected,
          );
        }
        for (const [spec, expected] of Object.entries(testCase.unreachable ?? {})) {
          assertLabeled(`isUnreachable(${spec})`, analysis.isUnreachable(resolve(spec)), expected);
        }
        for (const [spec, expected] of Object.entries(testCase.insideLoop ?? {})) {
          assertLabeled(`isInsideLoop(${spec})`, analysis.isInsideLoop(resolve(spec)), expected);
        }
        for (const [from, to, expected] of testCase.dominates ?? []) {
          assertLabeled(
            `dominates(${from}, ${to})`,
            analysis.dominates(resolve(from), resolve(to)),
            expected,
          );
        }
        for (const [from, to, expected] of testCase.postDominates ?? []) {
          assertLabeled(
            `postDominates(${from}, ${to})`,
            analysis.postDominates(resolve(from), resolve(to)),
            expected,
          );
        }
        for (const [from, to, expected] of testCase.reachable ?? []) {
          assertLabeled(
            `isReachable(${from}, ${to})`,
            analysis.isReachable(resolve(from), resolve(to)),
            expected,
          );
        }
      });
    }
  });
};
