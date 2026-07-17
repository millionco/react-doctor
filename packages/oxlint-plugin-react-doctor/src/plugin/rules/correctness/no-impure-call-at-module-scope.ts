import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Per the applied revision, `crypto.*` id/byte generators are dropped:
// stable per-process ids are the dominant, correct idiom at module scope.
// What remains fires regardless of intent: Math.random() sampling and
// wall-clock reads used in date/timezone math.
const IMPURE_MEMBER_CALLS = new Map<string, ReadonlySet<string>>([
  ["Math", new Set(["random"])],
  ["Date", new Set(["now"])],
  ["performance", new Set(["now"])],
]);

const impureBuiltinLabel = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "NewExpression")) {
    // Only the zero-argument `new Date()` is nondeterministic; a
    // timestamp/parts argument is deterministic.
    if (
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "Date" &&
      (node.arguments?.length ?? 0) === 0 &&
      !findVariableInitializer(node.callee, "Date")
    ) {
      return "new Date()";
    }
    return null;
  }
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Date" &&
    node.arguments.length === 0 &&
    !findVariableInitializer(node.callee, "Date")
  ) {
    return "Date()";
  }
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const allowedMethods = IMPURE_MEMBER_CALLS.get(receiver.name);
  if (!allowedMethods?.has(callee.property.name)) return null;
  // A same-file binding named `Math`/`Date`/`performance` shadows the global.
  if (findVariableInitializer(receiver, receiver.name)) return null;
  return `${receiver.name}.${callee.property.name}()`;
};

const serverValueOfTypeofBrowserGlobalTest = (test: EsTreeNode): boolean | null => {
  const expression = stripParenExpression(test);
  if (!isNodeOfType(expression, "BinaryExpression")) return null;
  const isUndefinedTypeof = (candidate: EsTreeNode): boolean =>
    isNodeOfType(candidate, "UnaryExpression") &&
    candidate.operator === "typeof" &&
    isNodeOfType(candidate.argument, "Identifier") &&
    (candidate.argument.name === "window" || candidate.argument.name === "document");
  const isUndefinedLiteral = (candidate: EsTreeNode): boolean =>
    isNodeOfType(candidate, "Literal") && candidate.value === "undefined";
  if (
    !(
      (isUndefinedTypeof(expression.left as EsTreeNode) && isUndefinedLiteral(expression.right)) ||
      (isUndefinedTypeof(expression.right) && isUndefinedLiteral(expression.left as EsTreeNode))
    )
  ) {
    return null;
  }
  if (expression.operator === "===" || expression.operator === "==") return true;
  if (expression.operator === "!==" || expression.operator === "!=") return false;
  return null;
};

const isModuleScopeEvaluation = (impureNode: EsTreeNode, context: RuleContext): boolean => {
  let child: EsTreeNode = impureNode;
  let cursor: EsTreeNode | null = impureNode.parent ?? null;
  let isStaticField = false;
  while (cursor) {
    if (isFunctionLike(cursor) || isNodeOfType(cursor, "MethodDefinition")) return false;

    // `typeof window === "undefined" ? 0 : performance.now()` — the branch
    // visible to the server render is the deterministic constant; the
    // impure read only ever runs in the browser.
    if (isNodeOfType(cursor, "ConditionalExpression") && cursor.test !== child) {
      const serverTestValue = serverValueOfTypeofBrowserGlobalTest(cursor.test as EsTreeNode);
      if (
        serverTestValue !== null &&
        ((cursor.consequent === child && !serverTestValue) ||
          (cursor.alternate === child && serverTestValue))
      ) {
        return false;
      }
    }

    if (isNodeOfType(cursor, "PropertyDefinition")) {
      if (cursor.static !== true || cursor.key === child) return false;
      isStaticField = true;
    }

    if (isNodeOfType(cursor, "VariableDeclarator")) {
      const declaration = cursor.parent;
      if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return false;
      if (declaration.kind !== "const") {
        const symbol = context.scopes.symbolFor(cursor.id);
        if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) {
          return false;
        }
      }
      let declarationParent = declaration.parent ?? null;
      if (declarationParent && isNodeOfType(declarationParent, "ExportNamedDeclaration")) {
        declarationParent = declarationParent.parent ?? null;
      }
      if (!declarationParent || !isNodeOfType(declarationParent, "Program")) return false;
      return true;
    }

    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return isStaticField;
};

export const noImpureCallAtModuleScope = defineRule({
  id: "no-impure-call-at-module-scope",
  title: "Nondeterministic built-in at module scope",
  severity: "warn",
  requires: ["ssr"],
  tags: ["test-noise"],
  recommendation:
    "`Math.random()`, `Date.now()`, `performance.now()`, and `new Date()` run once at module load, so the value is frozen for the whole server process. Move the call into a function/component so it evaluates per request.",
  create: (context: RuleContext) => {
    const check = (node: EsTreeNode): void => {
      const label = impureBuiltinLabel(node);
      if (!label) return;
      if (!isModuleScopeEvaluation(node, context)) return;
      context.report({
        node,
        message: `\`${label}\` runs once when this module loads, so the value is frozen for the whole server process and every SSR request reuses it — move it into a function or component so it evaluates per request.`,
      });
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        check(node);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        check(node);
      },
    };
  },
});
