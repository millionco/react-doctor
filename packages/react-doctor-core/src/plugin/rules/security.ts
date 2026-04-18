import {
  SECRET_FALSE_POSITIVE_SUFFIXES,
  SECRET_MIN_LENGTH_CHARS,
  SECRET_PATTERNS,
  SECRET_VARIABLE_PATTERN,
} from "../constants.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const noEval: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type === "Identifier" && node.callee.name === "eval") {
        context.report({
          node,
          message: "eval() is a code injection risk — avoid dynamic code execution",
        });
        return;
      }

      if (
        node.callee?.type === "Identifier" &&
        (node.callee.name === "setTimeout" || node.callee.name === "setInterval") &&
        node.arguments?.[0]?.type === "Literal" &&
        typeof node.arguments[0].value === "string"
      ) {
        context.report({
          node,
          message: `${node.callee.name}() with string argument executes code dynamically — use a function instead`,
        });
      }
    },
    NewExpression(node: EsTreeNode) {
      if (node.callee?.type === "Identifier" && node.callee.name === "Function") {
        context.report({
          node,
          message: "new Function() is a code injection risk — avoid dynamic code execution",
        });
      }
    },
  }),
};

export const noSecretsInClientCode: Rule = {
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNode) {
      if (node.id?.type !== "Identifier") return;
      if (node.init?.type !== "Literal" || typeof node.init.value !== "string") return;

      const variableName = node.id.name;
      const literalValue = node.init.value;

      const trailingSuffix = variableName.split("_").pop()?.toLowerCase() ?? "";
      const isUiConstant = SECRET_FALSE_POSITIVE_SUFFIXES.has(trailingSuffix);

      if (
        SECRET_VARIABLE_PATTERN.test(variableName) &&
        !isUiConstant &&
        literalValue.length > SECRET_MIN_LENGTH_CHARS
      ) {
        context.report({
          node,
          message: `Possible hardcoded secret in "${variableName}" — use environment variables instead`,
        });
        return;
      }

      if (SECRET_PATTERNS.some((pattern) => pattern.test(literalValue))) {
        context.report({
          node,
          message: "Hardcoded secret detected — use environment variables instead",
        });
      }
    },
  }),
};
