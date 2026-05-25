import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import { isAstNode } from "../plugin/utils/is-ast-node.js";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";
import type { ReportDescriptor } from "../plugin/utils/report-descriptor.js";
import type { Rule } from "../plugin/utils/rule.js";
import type { RuleContext } from "../plugin/utils/rule-context.js";
import type { RuleVisitors } from "../plugin/utils/rule-visitors.js";
import { analyzeScopes } from "../plugin/semantic/scope-analysis.js";
import { analyzeControlFlow } from "../plugin/semantic/control-flow-graph.js";

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
    const handler = visitors[node.type];
    if (typeof handler === "function") handler(node);
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
  };
  visit(root);
  const programExitHandler = visitors["Program:exit"];
  if (typeof programExitHandler === "function") programExitHandler(root);
};

// Pure-TS rule runner mirroring what oxlint does at runtime: parse code,
// attach `parent` references, build a fake `RuleContext`, dispatch each
// `node.type` / `Program:exit` to the matching visitor, and collect every
// `report({...})` call as a `RuleDiagnostic`. Used by every `<rule>.test.ts`
// to assert pass/fail semantics ported from OXC's `Tester::new(...).pass / .fail`.
export const runRule = (rule: Rule, code: string, options: RunRuleOptions = {}): RunRuleResult => {
  const parsed = parseFixture(code, {
    filename: options.filename,
    forceJsx: options.forceJsx,
  });
  attachParentReferences(parsed.program);

  const diagnostics: RuleDiagnostic[] = [];
  const scopes = analyzeScopes(parsed.program);
  const cfg = analyzeControlFlow(parsed.program);
  const context: RuleContext = {
    report: (descriptor: ReportDescriptor) => {
      diagnostics.push({
        message: descriptor.message,
        nodeType: descriptor.node.type,
      });
    },
    getFilename: () => options.filename ?? "fixture.tsx",
    settings: options.settings,
    scopes,
    cfg,
  };

  const visitors = rule.create(context);
  dispatchTreeWalk(parsed.program, visitors);

  return { diagnostics, parseErrors: parsed.errors };
};
