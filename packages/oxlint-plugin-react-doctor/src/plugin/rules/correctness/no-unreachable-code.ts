import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Statement kinds that hoist (function declarations) or carry no runtime
// effect (type-only TS declarations, import/export decls, the empty `;`),
// so sitting after a `return` / `throw` is harmless. ESLint's
// `no-unreachable` makes the same carve-out for hoisting.
const NON_REPORTABLE_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSModuleDeclaration",
  "TSDeclareFunction",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "EmptyStatement",
]);

// A bare `var x;` hoists with no runtime effect (the binding is created at
// the top of the scope), so it is harmless after a jump; only flag a `var`
// declaration that actually runs an initializer.
const isReportableStatement = (statement: EsTreeNode): boolean => {
  if (NON_REPORTABLE_STATEMENT_TYPES.has(statement.type)) return false;
  if (
    isNodeOfType(statement, "VariableDeclaration") &&
    statement.kind === "var" &&
    (statement.declarations ?? []).every((declarator) => !declarator.init)
  ) {
    return false;
  }
  return true;
};

// Report the first runtime statement of the dead tail of a straight-line
// statement list. A list whose FIRST statement is already unreachable is
// inherited-dead from an outer construct (e.g. a dead nested block), whose
// own statement is reported at the outer transition; skipping it keeps each
// dead region to a single diagnostic.
const reportFirstUnreachable = (
  context: RuleContext,
  statements: ReadonlyArray<EsTreeNode>,
): void => {
  if (statements.length === 0) return;
  if (context.cfg.isUnreachable(statements[0]!)) return;

  let deadIndex = -1;
  for (let index = 1; index < statements.length; index++) {
    if (context.cfg.isUnreachable(statements[index]!)) {
      deadIndex = index;
      break;
    }
  }
  if (deadIndex < 0) return;

  for (let index = deadIndex; index < statements.length; index++) {
    const statement = statements[index]!;
    if (isReportableStatement(statement)) {
      context.report({
        node: statement,
        message:
          "This code never runs: every path above it returns, throws, breaks, continues, or loops forever. Remove it or fix the control flow above.",
      });
      return;
    }
  }
};

export const noUnreachableCode = defineRule({
  id: "no-unreachable-code",
  title: "Unreachable code",
  severity: "warn",
  recommendation:
    "Remove the dead code or fix the control flow above it so the path can run. Code after a return, throw, break, continue, or infinite loop never executes.",
  create: (context: RuleContext) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      reportFirstUnreachable(context, node.body ?? []);
    },
    BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
      reportFirstUnreachable(context, node.body ?? []);
    },
    SwitchCase(node: EsTreeNodeOfType<"SwitchCase">) {
      reportFirstUnreachable(context, node.consequent ?? []);
    },
  }),
});
