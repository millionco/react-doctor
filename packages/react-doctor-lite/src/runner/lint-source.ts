import { parseSync } from "oxc-parser";
import { attachParentReferences } from "../utils/attach-parent-references.js";
import { attachSourceLocations } from "../utils/attach-source-locations.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { resolveParseLang } from "../utils/resolve-parse-lang.js";
import type { LiteDiagnostic, LiteRuleContext, LoadedRule } from "../types.js";
import type { EsTreeNode } from "oxlint-plugin-react-doctor";

export interface LintSourceInput {
  filePath: string;
  code: string;
  rules: ReadonlyArray<LoadedRule>;
  settings: Readonly<Record<string, unknown>>;
}

type Visitor = (node: EsTreeNode) => void;

interface NodeWithLoc {
  loc?: { start?: { line: number; column: number } };
}

// Lints a single source string entirely in-process: parse once with
// oxc-parser, wire up parent + loc, build each rule's visitors against a
// dedicated reporting context, then walk the tree ONCE dispatching every
// matching visitor. This is the whole runner — no subprocess, no oxlintrc, no
// stdout JSON parsing.
export const lintSource = (input: LintSourceInput): LiteDiagnostic[] => {
  const { filePath, code, rules, settings } = input;

  let program: EsTreeNode;
  try {
    const parsed = parseSync(filePath, code, {
      astType: "ts",
      lang: resolveParseLang(filePath),
    });
    program = parsed.program as unknown as EsTreeNode;
  } catch {
    return [];
  }

  attachParentReferences(program);
  attachSourceLocations(program, code);

  const diagnostics: LiteDiagnostic[] = [];
  const enterVisitorsBySelector = new Map<string, Visitor[]>();
  const exitVisitors: Visitor[] = [];

  for (const rule of rules) {
    const context: LiteRuleContext = {
      report: ({ node, message }) => {
        const position = (node as NodeWithLoc).loc?.start;
        diagnostics.push({
          filePath,
          rule: rule.id,
          ruleKey: rule.key,
          severity: rule.severity,
          category: rule.category,
          message,
          recommendation: rule.recommendation,
          line: position?.line ?? 1,
          column: position === undefined ? 1 : position.column + 1,
        });
      },
      getFilename: () => filePath,
      settings,
    };

    const visitors = rule.create(context);
    for (const [selector, handler] of Object.entries(visitors)) {
      if (typeof handler !== "function") continue;
      if (selector === "Program:exit") {
        exitVisitors.push(handler as Visitor);
        continue;
      }
      const existing = enterVisitorsBySelector.get(selector);
      if (existing) existing.push(handler as Visitor);
      else enterVisitorsBySelector.set(selector, [handler as Visitor]);
    }
  }

  const walk = (node: EsTreeNode): void => {
    const handlers = enterVisitorsBySelector.get(node.type);
    if (handlers) {
      for (const handler of handlers) handler(node);
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) walk(item);
        }
      } else if (isAstNode(child)) {
        walk(child);
      }
    }
  };

  walk(program);
  for (const handler of exitVisitors) handler(program);

  return diagnostics;
};
