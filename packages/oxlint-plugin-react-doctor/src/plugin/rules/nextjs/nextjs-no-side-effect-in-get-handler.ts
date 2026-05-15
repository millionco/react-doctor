import {
  CRON_ROUTE_PATTERN,
  MUTATING_ROUTE_SEGMENTS,
  ROUTE_HANDLER_FILE_PATTERN,
} from "../../constants/nextjs.js";
import { GET_HANDLER_BINDING_RESOLUTION_DEPTH } from "../../constants/thresholds.js";
import { collectLocallyScopedCookieBindings } from "../../utils/collect-locally-scoped-cookie-bindings.js";
import { collectLocallyScopedSafeBindings } from "../../utils/collect-locally-scoped-safe-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSideEffect } from "../../utils/find-side-effect.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const extractMutatingRouteSegment = (filename: string): string | null => {
  const segments = filename.split("/");
  for (const segment of segments) {
    const cleaned = segment.replace(/^\[.*\]$/, "");
    if (MUTATING_ROUTE_SEGMENTS.has(cleaned)) return cleaned;
  }
  return null;
};

const buildProgramBindingLookup = (
  programNode: EsTreeNode,
): ((identifierName: string) => EsTreeNode | null) => {
  const topLevelBindings = new Map<string, EsTreeNode>();
  if (!isNodeOfType(programNode, "Program")) return () => null;

  const collectFromStatements = (statements: EsTreeNode[]): void => {
    for (const statement of statements) {
      if (isNodeOfType(statement, "VariableDeclaration")) {
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          if (!declarator.init) continue;
          topLevelBindings.set(declarator.id.name, declarator.init);
        }
        continue;
      }
      if (
        isNodeOfType(statement, "FunctionDeclaration") &&
        isNodeOfType(statement.id, "Identifier") &&
        statement.body
      ) {
        topLevelBindings.set(statement.id.name, statement);
        continue;
      }
      if (isNodeOfType(statement, "ExportNamedDeclaration") && statement.declaration) {
        collectFromStatements([statement.declaration]);
      }
    }
  };

  collectFromStatements(programNode.body ?? []);
  return (identifierName: string) => topLevelBindings.get(identifierName) ?? null;
};

const isExportedGetHandler = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ExportNamedDeclaration")) return false;
  const declaration = node.declaration;
  if (!declaration) return false;

  if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id?.name === "GET") {
    return true;
  }

  if (isNodeOfType(declaration, "VariableDeclaration")) {
    for (const declarator of declaration.declarations ?? []) {
      if (isNodeOfType(declarator?.id, "Identifier") && declarator.id.name === "GET") {
        return true;
      }
    }
  }

  return false;
};

const isGetMethodCall = (callExpression: EsTreeNode): boolean =>
  isNodeOfType(callExpression, "CallExpression") &&
  isNodeOfType(callExpression.callee, "MemberExpression") &&
  isNodeOfType(callExpression.callee.property, "Identifier") &&
  callExpression.callee.property.name === "get";

const isStringLikeNode = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && typeof node.value === "string") ||
  isNodeOfType(node, "TemplateLiteral");

const getHandlerCallbackBody = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length < 2) return null;
  const routePatternArgument = callArguments[0];
  if (!isStringLikeNode(routePatternArgument)) return null;
  const handlerArgument = callArguments[callArguments.length - 1];
  if (
    (isNodeOfType(handlerArgument, "ArrowFunctionExpression") ||
      isNodeOfType(handlerArgument, "FunctionExpression")) &&
    handlerArgument.body
  ) {
    return handlerArgument.body;
  }
  return null;
};

const collectChainedGetHandlerBodies = (initNode: EsTreeNode): EsTreeNode[] => {
  const chainedBodies: EsTreeNode[] = [];
  let cursor: EsTreeNode | null | undefined = initNode;
  while (cursor && isNodeOfType(cursor, "CallExpression")) {
    if (isGetMethodCall(cursor)) {
      const body = getHandlerCallbackBody(cursor);
      if (body) chainedBodies.push(body);
    }
    cursor = isNodeOfType(cursor.callee, "MemberExpression") ? cursor.callee.object : null;
  }
  return chainedBodies;
};

const resolveBodiesFromExpression = (
  expression: EsTreeNode,
  resolveBinding: (identifierName: string) => EsTreeNode | null,
  remainingDepth: number,
): EsTreeNode[] => {
  if (remainingDepth <= 0) return [];

  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return expression.body ? [expression.body] : [];
  }

  if (isNodeOfType(expression, "CallExpression")) {
    for (const callArgument of expression.arguments ?? []) {
      if (
        isNodeOfType(callArgument, "ArrowFunctionExpression") ||
        isNodeOfType(callArgument, "FunctionExpression")
      ) {
        if (callArgument.body) return [callArgument.body];
      }
      if (!isNodeOfType(callArgument, "Identifier")) continue;
      const argumentInit = resolveBinding(callArgument.name);
      if (!argumentInit) continue;
      const resolvedBodies = resolveBodiesFromExpression(
        argumentInit,
        resolveBinding,
        remainingDepth - 1,
      );
      if (resolvedBodies.length > 0) return resolvedBodies;
      const chainedBodies = collectChainedGetHandlerBodies(argumentInit);
      if (chainedBodies.length > 0) return chainedBodies;
    }
    return [];
  }

  if (isNodeOfType(expression, "Identifier")) {
    const boundInit = resolveBinding(expression.name);
    if (!boundInit) return [];
    return resolveBodiesFromExpression(boundInit, resolveBinding, remainingDepth - 1);
  }

  return [];
};

const resolveGetHandlerBodies = (
  exportNode: EsTreeNode,
  resolveBinding: (identifierName: string) => EsTreeNode | null,
): EsTreeNode[] => {
  if (!isNodeOfType(exportNode, "ExportNamedDeclaration")) return [];
  const declaration = exportNode.declaration;
  if (!declaration) return [];

  if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id?.name === "GET") {
    return declaration.body ? [declaration.body] : [];
  }

  if (!isNodeOfType(declaration, "VariableDeclaration")) return [];

  for (const declarator of declaration.declarations ?? []) {
    if (!isNodeOfType(declarator.id, "Identifier") || declarator.id.name !== "GET") continue;
    if (!declarator.init) return [];
    return resolveBodiesFromExpression(
      declarator.init,
      resolveBinding,
      GET_HANDLER_BINDING_RESOLUTION_DEPTH,
    );
  }

  return [];
};

export const nextjsNoSideEffectInGetHandler = defineRule<Rule>({
  id: "nextjs-no-side-effect-in-get-handler",
  requires: ["nextjs"],
  severity: "error",
  category: "Security",
  recommendation:
    "Move the side effect to a POST handler and use a <form> or fetch with method POST — GET requests can be triggered by prefetching and are vulnerable to CSRF",
  create: (context: RuleContext) => {
    let resolveBinding: (identifierName: string) => EsTreeNode | null = () => null;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        resolveBinding = buildProgramBindingLookup(node);
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        const filename = context.getFilename?.() ?? "";
        if (!ROUTE_HANDLER_FILE_PATTERN.test(filename)) return;
        if (CRON_ROUTE_PATTERN.test(filename)) return;
        if (!isExportedGetHandler(node)) return;

        const mutatingSegment = extractMutatingRouteSegment(filename);
        if (mutatingSegment) {
          context.report({
            node,
            message: `GET handler on "/${mutatingSegment}" route — use POST to prevent CSRF and unintended prefetch triggers`,
          });
          return;
        }

        const handlerBodies = resolveGetHandlerBodies(node, resolveBinding);
        for (const handlerBody of handlerBodies) {
          const locallyScopedSafeBindings = collectLocallyScopedSafeBindings(handlerBody);
          const locallyScopedCookieBindings = collectLocallyScopedCookieBindings(handlerBody);
          const sideEffect = findSideEffect(handlerBody, {
            locallyScopedSafeBindings,
            locallyScopedCookieBindings,
          });
          if (!sideEffect) continue;
          context.report({
            node,
            message: `GET handler has side effects (${sideEffect}) — use POST to prevent CSRF and unintended prefetch triggers`,
          });
          return;
        }
      },
    };
  },
});
