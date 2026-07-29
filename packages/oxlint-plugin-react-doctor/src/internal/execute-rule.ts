import { runWithResourceHost } from "./resource-host/resource-host-context.js";
import type { ResourceHost } from "./resource-host/resource-host.js";
import { analyzeControlFlow } from "../plugin/semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../plugin/semantic/control-flow-graph.js";
import { analyzeScopes } from "../plugin/semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../plugin/semantic/scope-analysis.js";
import { attachParentReferences } from "../plugin/utils/attach-parent-references.js";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";
import { isAstNode } from "../plugin/utils/is-ast-node.js";
import type { ReportDescriptor } from "../plugin/utils/report-descriptor.js";
import type { Rule } from "../plugin/utils/rule.js";
import type { RuleContext } from "../plugin/utils/rule-context.js";
import type { RuleVisitors } from "../plugin/utils/rule-visitors.js";
import { attachSourceLocations } from "./attach-source-locations.js";
import type { ParseSourceResult } from "./parse-source.js";

export interface ExecuteRuleOptions {
  readonly filename?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly resourceHost?: ResourceHost;
  readonly forceJsx?: boolean;
}

export interface ExecutedRuleDiagnostic {
  readonly message: string;
  readonly node: EsTreeNode;
}

export interface ExecuteRuleResult {
  readonly diagnostics: ReadonlyArray<ExecutedRuleDiagnostic>;
  readonly parseErrors: ReadonlyArray<{ readonly message: string }>;
}

const dispatchRuleVisitors = (root: EsTreeNode, visitors: RuleVisitors): void => {
  const visitNode = (node: EsTreeNode): void => {
    const enterHandler = visitors[node.type];
    if (typeof enterHandler === "function") enterHandler(node);
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const childNode of child) {
          if (isAstNode(childNode)) visitNode(childNode);
        }
      } else if (isAstNode(child)) {
        visitNode(child);
      }
    }
    const exitHandler = visitors[`${node.type}:exit`];
    if (typeof exitHandler === "function") exitHandler(node);
  };
  visitNode(root);
};

export const executeRule = (
  rule: Rule,
  sourceText: string,
  parsedSource: ParseSourceResult,
  options: ExecuteRuleOptions = {},
): ExecuteRuleResult => {
  attachParentReferences(parsedSource.program);
  attachSourceLocations(parsedSource.program, sourceText);

  const diagnostics: ExecutedRuleDiagnostic[] = [];
  let scopes: ScopeAnalysis | undefined;
  let controlFlow: ControlFlowAnalysis | undefined;
  const context: RuleContext = {
    report: (descriptor: ReportDescriptor) => {
      diagnostics.push({
        message: descriptor.message,
        node: descriptor.node,
      });
    },
    filename: "filename" in options ? options.filename : "fixture.tsx",
    settings: options.settings,
    get scopes() {
      scopes ??= analyzeScopes(parsedSource.program);
      return scopes;
    },
    get cfg() {
      controlFlow ??= analyzeControlFlow(parsedSource.program);
      return controlFlow;
    },
  };

  const runRule = (): void => {
    const visitors = rule.create(context);
    dispatchRuleVisitors(parsedSource.program, visitors);
  };
  if (options.resourceHost) {
    runWithResourceHost(options.resourceHost, runRule);
  } else {
    runRule();
  }

  return {
    diagnostics,
    parseErrors: parsedSource.errors.map((parseError) => ({ message: parseError.message })),
  };
};
