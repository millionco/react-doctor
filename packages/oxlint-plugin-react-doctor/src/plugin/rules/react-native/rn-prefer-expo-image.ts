import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isExpoManagedFileActive } from "../../utils/is-expo-managed-file.js";

const EMPTY_VISITORS: RuleVisitors = {};

const BUNDLED_ASSET_SOURCE_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

const MEMBER_PATH_FAN_OUT_LIMIT = 32;

interface FlaggedImageImport {
  readonly localName: string;
  readonly importedName: string;
  readonly specifier: EsTreeNode;
}

const isRequireOfBundledAsset = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "require" &&
  node.arguments?.length === 1 &&
  isNodeOfType(node.arguments[0], "Literal") &&
  typeof node.arguments[0].value === "string" &&
  BUNDLED_ASSET_SOURCE_PATTERN.test(node.arguments[0].value);

interface MemberPathStep {
  readonly key: string | null;
}

// Flattens `textMap[modalType].icon` into its root identifier plus the
// property path — computed dynamic steps become `key: null` (fan out to
// every property value when resolving).
const flattenMemberPath = (
  node: EsTreeNodeOfType<"MemberExpression">,
): { rootName: string; path: MemberPathStep[] } | null => {
  const path: MemberPathStep[] = [];
  let cursor: EsTreeNode = node;
  while (isNodeOfType(cursor, "MemberExpression")) {
    if (!cursor.computed && isNodeOfType(cursor.property, "Identifier")) {
      path.unshift({ key: cursor.property.name });
    } else if (
      cursor.computed &&
      isNodeOfType(cursor.property, "Literal") &&
      typeof cursor.property.value === "string"
    ) {
      path.unshift({ key: cursor.property.value });
    } else if (cursor.computed) {
      path.unshift({ key: null });
    } else {
      return null;
    }
    cursor = cursor.object;
  }
  if (!isNodeOfType(cursor, "Identifier")) return null;
  return { rootName: cursor.name, path };
};

const propertyKeyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property") || property.computed) return null;
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

export const rnPreferExpoImage = defineRule({
  id: "rn-prefer-expo-image",
  title: "react-native Image instead of expo-image",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `<Image>` from `expo-image` instead of `react-native`. Same props, plus caching, placeholders, and crossfades for faster image loading.",
  create: (context: RuleContext) => {
    if (!isExpoManagedFileActive(context)) return EMPTY_VISITORS;

    const flaggedImports: FlaggedImageImport[] = [];
    const assetBindingNames = new Set<string>();
    const moduleObjectLiterals = new Map<string, EsTreeNodeOfType<"ObjectExpression">>();
    const sourceExpressionsByLocalName = new Map<string, (EsTreeNode | null)[]>();

    // Resolves a member path through a module-level object literal
    // (`textMap[modalType].icon`) to every value it can reach; a dynamic
    // computed step fans out to all property values.
    const resolveMemberCandidates = (
      literal: EsTreeNodeOfType<"ObjectExpression">,
      path: MemberPathStep[],
    ): EsTreeNode[] | null => {
      let candidates: EsTreeNode[] = [literal];
      for (const step of path) {
        const next: EsTreeNode[] = [];
        for (const candidate of candidates) {
          if (!isNodeOfType(candidate, "ObjectExpression")) return null;
          for (const property of candidate.properties ?? []) {
            const keyName = propertyKeyName(property);
            if (keyName === null || !isNodeOfType(property, "Property")) return null;
            if (step.key === null || step.key === keyName) next.push(property.value);
          }
        }
        if (next.length === 0 || next.length > MEMBER_PATH_FAN_OUT_LIMIT) return null;
        candidates = next;
      }
      return candidates;
    };

    const isStaticAssetExpression = (expression: EsTreeNode): boolean => {
      if (isNodeOfType(expression, "Identifier")) {
        return assetBindingNames.has(expression.name);
      }
      if (isRequireOfBundledAsset(expression)) return true;
      if (isNodeOfType(expression, "MemberExpression")) {
        const flattened = flattenMemberPath(expression);
        if (!flattened) return false;
        const literal = moduleObjectLiterals.get(flattened.rootName);
        if (!literal) return false;
        const candidates = resolveMemberCandidates(literal, flattened.path);
        if (!candidates) return false;
        return candidates.every(
          (candidate) =>
            (isNodeOfType(candidate, "Identifier") && assetBindingNames.has(candidate.name)) ||
            isRequireOfBundledAsset(candidate),
        );
      }
      return false;
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string") return;

        if (BUNDLED_ASSET_SOURCE_PATTERN.test(source)) {
          for (const specifier of node.specifiers ?? []) {
            if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
              assetBindingNames.add(specifier.local.name);
            }
          }
          return;
        }

        if (source !== "react-native") return;
        if (isTypeOnlyImport(node)) return;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (specifier.importKind === "type") continue;
          const importedName = getImportedName(specifier);
          if (importedName !== "Image" && importedName !== "ImageBackground") continue;
          flaggedImports.push({ localName: specifier.local.name, importedName, specifier });
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        if (isRequireOfBundledAsset(node.init)) {
          assetBindingNames.add(node.id.name);
          return;
        }
        if (isNodeOfType(node.init, "ObjectExpression") && !isInsideFunctionScope(node)) {
          moduleObjectLiterals.set(node.id.name, node.init);
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const localName = node.name.name;
        const sourceAttribute = findJsxAttribute(node.attributes, "source");
        const sourceExpression =
          sourceAttribute?.value && isNodeOfType(sourceAttribute.value, "JSXExpressionContainer")
            ? sourceAttribute.value.expression
            : null;
        const usages = sourceExpressionsByLocalName.get(localName) ?? [];
        usages.push(sourceExpression);
        sourceExpressionsByLocalName.set(localName, usages);
      },
      "Program:exit"() {
        for (const flagged of flaggedImports) {
          const usages = sourceExpressionsByLocalName.get(flagged.localName);
          // Bundled assets ship inside the app package and never re-download,
          // so when every rendered usage provably points at one, the
          // "images reload because Image has no caching" claim is false.
          const everyUsageIsBundledAsset =
            usages !== undefined &&
            usages.length > 0 &&
            usages.every(
              (sourceExpression) =>
                sourceExpression !== null && isStaticAssetExpression(sourceExpression),
            );
          if (everyUsageIsBundledAsset) continue;
          context.report({
            node: flagged.specifier,
            message: `Your users watch images reload often because ${flagged.importedName} from react-native has no caching.`,
          });
        }
      },
    };
  },
});
