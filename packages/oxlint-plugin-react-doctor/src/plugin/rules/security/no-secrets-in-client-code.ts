import {
  PUBLIC_CLIENT_KEY_PATTERNS,
  SECRET_FALSE_POSITIVE_SUFFIXES,
  SECRET_MIN_LENGTH_CHARS,
  SECRET_PLACEHOLDER_CONTEXT_PATTERN,
  SECRET_PATTERNS,
  SECRET_VARIABLE_PATTERN,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { classifySecretFileExposure } from "../../utils/classify-secret-file-exposure.js";
import { getIdentifierTrailingWord } from "../../utils/get-identifier-trailing-word.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isInsideServerOnlyScope } from "../../utils/is-inside-server-only-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPlaceholderSecretValue } from "../../utils/is-placeholder-secret-value.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasPlaceholderSecretContext = (node: EsTreeNode, variableName: string): boolean => {
  if (SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(variableName)) return true;

  let ancestor = node.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "FunctionDeclaration") && ancestor.id) {
      if (SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(ancestor.id.name)) return true;
    }

    if (isNodeOfType(ancestor, "ClassDeclaration") && ancestor.id) {
      if (SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(ancestor.id.name)) return true;
    }

    if (
      (isNodeOfType(ancestor, "FunctionExpression") ||
        isNodeOfType(ancestor, "ArrowFunctionExpression")) &&
      isNodeOfType(ancestor.parent, "VariableDeclarator") &&
      isNodeOfType(ancestor.parent.id, "Identifier") &&
      SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(ancestor.parent.id.name)
    ) {
      return true;
    }

    ancestor = ancestor.parent ?? null;
  }

  return false;
};

export const noSecretsInClientCode = defineRule<Rule>({
  id: "no-secrets-in-client-code",
  title: "Secret in client code",
  severity: "warn",
  recommendation:
    "Move secrets to server-only code. Anything in client env variables gets shipped to the browser, so it can't hold secrets.",
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
    const framework = getReactDoctorStringSetting(context.settings, "framework");
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    let shouldUseVariableNameHeuristic =
      classifySecretFileExposure(filename, { framework, rootDirectory }) === "client";

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        shouldUseVariableNameHeuristic =
          classifySecretFileExposure(filename, {
            framework,
            hasUseClientDirective: hasDirective(programNode, "use client"),
            hasUseServerDirective: hasDirective(programNode, "use server"),
            rootDirectory,
          }) === "client";
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isNodeOfType(node.init, "Literal") || typeof node.init.value !== "string") return;

        const variableName = node.id.name;
        const literalValue = node.init.value;
        const isPlaceholderValue = isPlaceholderSecretValue(
          literalValue,
          hasPlaceholderSecretContext(node, variableName),
        );

        // Public, client-safe keys ship in the browser by design; skip
        // them before either detector can flag them.
        if (
          isPlaceholderValue ||
          PUBLIC_CLIENT_KEY_PATTERNS.some((pattern) => pattern.test(literalValue))
        ) {
          return;
        }

        const isServerOnlyScope = isInsideServerOnlyScope(node);

        const trailingSuffix = getIdentifierTrailingWord(variableName);
        const isUiConstant = SECRET_FALSE_POSITIVE_SUFFIXES.has(trailingSuffix);

        if (
          shouldUseVariableNameHeuristic &&
          !isServerOnlyScope &&
          SECRET_VARIABLE_PATTERN.test(variableName) &&
          !isUiConstant &&
          literalValue.length > SECRET_MIN_LENGTH_CHARS
        ) {
          context.report({
            node,
            message: `Hardcoding "${variableName}" in client code is a security vulnerability: the secret ships to the browser where anyone can read it.`,
          });
          return;
        }

        if (SECRET_PATTERNS.some((pattern) => pattern.test(literalValue))) {
          context.report({
            node,
            message:
              "This hardcoded secret is a security vulnerability: it ships to the browser where anyone can read it.",
          });
        }
      },
    };
  },
});
