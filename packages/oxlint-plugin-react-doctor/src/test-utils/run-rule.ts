import { attachParentReferences } from "./attach-parent-references.js";
import { attachSourceLocations } from "./attach-source-locations.js";
import { parseFixture } from "./parse-fixture.js";
import type { ParseFixtureResult } from "./parse-fixture.js";
import { isAstNode } from "../plugin/utils/is-ast-node.js";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";
import type { ReportDescriptor } from "../plugin/utils/report-descriptor.js";
import type { Rule } from "../plugin/utils/rule.js";
import type { RuleContext } from "../plugin/utils/rule-context.js";
import type { RuleVisitors } from "../plugin/utils/rule-visitors.js";
import { analyzeScopes } from "../plugin/semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../plugin/semantic/scope-analysis.js";
import { analyzeControlFlow } from "../plugin/semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../plugin/semantic/control-flow-graph.js";

export interface RunRuleOptions {
  filename?: string;
  settings?: Readonly<Record<string, unknown>>;
  // Parse the fixture with TSX even when the filename suggests `.js`/`.ts`.
  // Useful for tests that want a non-JSX-friendly extension on the rule
  // context but still need JSX in the source.
  forceJsx?: boolean;
}

export interface RuleDiagnostic {
  message: string;
  nodeType: string;
}

export interface RunRuleResult {
  diagnostics: RuleDiagnostic[];
  parseErrors: ReadonlyArray<{ message: string }>;
}

const dispatchTreeWalk = (root: EsTreeNode, visitors: RuleVisitors): void => {
  const visit = (node: EsTreeNode): void => {
    const enterHandler = visitors[node.type];
    if (typeof enterHandler === "function") enterHandler(node);
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
    const exitHandler = visitors[`${node.type}:exit`];
    if (typeof exitHandler === "function") exitHandler(node);
  };
  visit(root);
};

// Pure-TS rule runner mirroring what oxlint does at runtime: parse code,
// attach `parent` references, build a fake `RuleContext`, dispatch each
// `node.type` visitor pre-order and each `${node.type}:exit` visitor
// post-order (exactly the enter/exit pairs oxlint compiles), and collect
// every `report({...})` call as a `RuleDiagnostic`. Used by every
// `<rule>.test.ts` to assert pass/fail semantics ported from OXC's
// `Tester::new(...).pass / .fail`.
export const runRuleOnParsedFixture = (
  rule: Rule,
  code: string,
  parsed: ParseFixtureResult,
  options: RunRuleOptions = {},
): RunRuleResult => {
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, code);

  const diagnostics: RuleDiagnostic[] = [];
  let scopes: ScopeAnalysis | undefined;
  let controlFlow: ControlFlowAnalysis | undefined;
  const context: RuleContext = {
    report: (descriptor: ReportDescriptor) => {
      diagnostics.push({
        message: descriptor.message,
        nodeType: descriptor.node.type,
      });
    },
    // `in` (not `?? "fixture.tsx"`) so a test can pass `{ filename: undefined }`
    // to exercise a host with no filename.
    filename: "filename" in options ? options.filename : "fixture.tsx",
    settings: options.settings,
    get scopes() {
      scopes ??= analyzeScopes(parsed.program);
      return scopes;
    },
    get cfg() {
      controlFlow ??= analyzeControlFlow(parsed.program);
      return controlFlow;
    },
  };

  const visitors = rule.create(context);
  dispatchTreeWalk(parsed.program, visitors);

  return { diagnostics, parseErrors: parsed.errors };
};

export const runRule = (rule: Rule, code: string, options: RunRuleOptions = {}): RunRuleResult => {
  const parsed = parseFixture(code, {
    filename: options.filename,
    forceJsx: options.forceJsx,
  });
  return runRuleOnParsedFixture(rule, code, parsed, options);
};
