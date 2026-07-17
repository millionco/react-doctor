import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const MOTION_REACT_MODULES: ReadonlySet<string> = new Set([
  "framer-motion",
  "motion/react",
  "motion/react-client",
]);
const ROOT_MOTION_CONFIG_FILE_PATTERN =
  /(?:^|\/)app\/layout\.[jt]sx$|(?:^|\/)pages\/_app\.[jt]sx$|(?:^|\/)(?:app|main|root)\.[jt]sx$/i;

const getImportSource = (symbol: SymbolDescriptor): string | null => {
  if (symbol.kind !== "import") return null;
  const importDeclaration = symbol.declarationNode.parent;
  if (
    !importDeclaration ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    isTypeOnlyImport(importDeclaration)
  ) {
    return null;
  }
  return typeof importDeclaration.source.value === "string" ? importDeclaration.source.value : null;
};

const isMotionConfigElement = (node: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(node, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(node, context.scopes);
    const source = symbol ? getImportSource(symbol) : null;
    return Boolean(
      symbol &&
      source &&
      MOTION_REACT_MODULES.has(source) &&
      getImportedName(symbol.declarationNode) === "MotionConfig",
    );
  }
  if (
    !isNodeOfType(node, "JSXMemberExpression") ||
    !isNodeOfType(node.object, "JSXIdentifier") ||
    !isNodeOfType(node.property, "JSXIdentifier") ||
    node.property.name !== "MotionConfig"
  ) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(node.object, context.scopes);
  const source = symbol ? getImportSource(symbol) : null;
  return Boolean(
    symbol &&
    source &&
    MOTION_REACT_MODULES.has(source) &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

export const noStaticMotionConfigNever = defineRule({
  id: "no-static-motion-config-never",
  title: "MotionConfig always ignores reduced motion",
  severity: "warn",
  category: "A11y",
  recommendation:
    'Use `reducedMotion="user"`, or derive the value from an explicit user preference instead of permanently disabling reduced-motion support.',
  create: (context: RuleContext): RuleVisitors => {
    if (!ROOT_MOTION_CONFIG_FILE_PATTERN.test(normalizeFilename(context.filename ?? ""))) return {};
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isMotionConfigElement(node.name, context)) return;
        const reducedMotionAttribute = getAuthoritativeJsxAttribute(
          node.attributes,
          "reducedMotion",
        );
        if (
          !reducedMotionAttribute ||
          getStringLiteralAttributeValue(reducedMotionAttribute) !== "never"
        ) {
          return;
        }
        context.report({
          node: reducedMotionAttribute,
          message:
            'This MotionConfig hard-codes reducedMotion="never", so transform and layout motion ignores the user\'s operating-system preference.',
        });
      },
    };
  },
});
