import {
  AUTH_CHECK_LOOKAHEAD_STATEMENTS,
  AUTH_FUNCTION_NAMES,
  SERVER_ACTION_DIRECTORY_PATTERN,
  SERVER_ACTION_FILE_PATTERN,
} from "../constants.js";
import { hasDirective, hasUseServerDirective, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const containsAuthCheck = (statements: EsTreeNode[]): boolean => {
  let foundAuthCall = false;
  for (const statement of statements) {
    walkAst(statement, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      let callNode: EsTreeNode | null = null;
      if (child.type === "CallExpression") {
        callNode = child;
      } else if (child.type === "AwaitExpression" && child.argument?.type === "CallExpression") {
        callNode = child.argument;
      }

      if (
        callNode?.callee?.type === "Identifier" &&
        AUTH_FUNCTION_NAMES.has(callNode.callee.name)
      ) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

export const serverAuthActions: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNode) {
        const declaration = node.declaration;
        if (declaration?.type !== "FunctionDeclaration" || !declaration?.async) return;

        const isServerAction = fileHasUseServerDirective || hasUseServerDirective(declaration);
        if (!isServerAction) return;

        const firstStatements = (declaration.body?.body ?? []).slice(
          0,
          AUTH_CHECK_LOOKAHEAD_STATEMENTS,
        );
        if (!containsAuthCheck(firstStatements)) {
          const functionName = declaration.id?.name ?? "anonymous";
          context.report({
            node: declaration.id ?? node,
            message: `Server action "${functionName}" — add auth check (auth(), getSession(), etc.) at the top`,
          });
        }
      },
    };
  },
};

export const serverAfterNonblocking: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      CallExpression(node: EsTreeNode) {
        if (!fileHasUseServerDirective) return;
        if (node.callee?.type !== "MemberExpression") return;
        if (node.callee.property?.type !== "Identifier") return;

        const objectName =
          node.callee.object?.type === "Identifier" ? node.callee.object.name : null;
        if (!objectName) return;

        const methodName = node.callee.property.name;
        const isLoggingCall =
          (objectName === "console" &&
            (methodName === "log" || methodName === "info" || methodName === "warn")) ||
          (objectName === "analytics" &&
            (methodName === "track" || methodName === "identify" || methodName === "page"));
        if (!isLoggingCall) return;

        context.report({
          node,
          message: `${objectName}.${methodName}() in server action — use after() for non-blocking logging/analytics`,
        });
      },
    };
  },
};
