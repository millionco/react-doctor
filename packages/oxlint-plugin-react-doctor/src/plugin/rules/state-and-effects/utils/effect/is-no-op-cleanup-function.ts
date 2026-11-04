import type { Scope } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { isAstNode } from "../../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { isNoOpFunction } from "../../../../utils/is-no-op-function.js";
import { isFunctionLike } from "../../../../utils/is-function-like.js";
import { stripParenExpression } from "../../../../utils/strip-paren-expression.js";
import type { NoOpExpressionOptions } from "../../../../utils/is-no-op-expression.js";
import { getRef } from "./ast.js";
import type { ProgramAnalysis } from "./get-program-analysis.js";

export const isNoOpCleanupFunction = (analysis: ProgramAnalysis, node: EsTreeNode): boolean => {
  const asyncReturn = isFunctionLike(node) && node.async ? stripParenExpression(node.body) : null;
  const noOpOptions: NoOpExpressionOptions = {
    isNoOpIdentifier: (identifier) => {
      const reference = getRef(analysis, identifier);
      if (!reference || reference.tainted) return false;
      for (let scope: Scope | null = reference.from; scope; scope = scope.upper) {
        if (scope.type === "with") return false;
      }
      if (identifier === asyncReturn) return identifier.name === "undefined" && !reference.resolved;
      if (!reference.resolved) return identifier.name === "undefined";
      return (
        reference.resolved.scope.type !== "global" &&
        reference.resolved.defs.some((definition) => {
          if (!isAstNode(definition.node)) return false;
          let declaration: EsTreeNode | null | undefined = definition.node;
          while (declaration && !isNodeOfType(declaration, "Program")) {
            if ("declare" in declaration && declaration.declare) return false;
            if (
              (isNodeOfType(declaration, "ImportDeclaration") ||
                isNodeOfType(declaration, "ImportSpecifier")) &&
              declaration.importKind === "type"
            )
              return false;
            declaration = declaration.parent;
          }
          return true;
        })
      );
    },
  };
  return isNoOpFunction(node, noOpOptions);
};
