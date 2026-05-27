# Proposal: `react-doctor/prefer-optimized-image`

> **Status**: 🟡 Auto-discovered draft proposal from a curated **knowledge-base** principle. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                               |
| ---------------------- | ----------------------------- |
| Category               | `react-native`                |
| Severity               | `warn`                        |
| Source cluster         | `NEW::prefer-optimized-image` |
| Backing evidence units | 1                             |

## Why the bug exists

> Developers reach for React Native's built-in Image because it is available by default and has a familiar API. In Expo apps, that choice misses built-in caching, placeholders, progressive loading, and perceived-performance wins from expo-image.

## Generality check

> Remote images and image-heavy lists are common across Expo React Native apps, and importing the core Image component is a deterministic source-level signal. The detector is gated to Expo-managed files or projects so it does not prescribe an Expo-specific dependency to bare React Native packages.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) via a new **knowledge-doc evidence source** that mines curated principle libraries (this evidence comes from the [react-doctor-knowledge-base](https://github.com/millionco/react-doctor-knowledge-base) repo). Pipeline:

```
knowledge-base markdown -> heading-anchored section split -> EvidenceUnit (KnowledgeDocMeta) -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing principle

- Skill: **vercel-react-native-skills** — section _Use expo-image for Optimized Images_ of `vercel-react-native-skills`

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review):

> Confirm the file belongs to an Expo-managed React Native app and the flagged import is a runtime Image component, not a type-only import. Typical false positives are bare React Native packages inside an Expo monorepo that cannot use Expo modules, and wrapper or compatibility modules intentionally re-exporting react-native Image for non-Expo consumers. If this file is a platform boundary or package-level abstraction, suppress rather than auto-fix.

## Fix prompt

> Replace the runtime Image import with Image from expo-image and keep compatible props like source and style. For namespace usage, import the component directly instead of rendering ReactNative.Image. Example: `import { Image } from "expo-image";` then `<Image source={{ uri: url }} contentFit="cover" cachePolicy="memory-disk" />`.

## Positive fixture (SHOULD trigger)

```tsx
import { Image } from "react-native";

export function Avatar({ url }: { url: string }) {
  return <Image source={{ uri: url }} />;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { Image } from "expo-image";

export function Avatar({ url }: { url: string }) {
  return <Image source={{ uri: url }} contentFit="cover" />;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/react-native/prefer-optimized-image.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isExpoManagedFileActive } from "../../utils/is-expo-managed-file.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};
const REACT_NATIVE_PACKAGE_NAME = "react-native";
const EXPO_IMAGE_PACKAGE_NAME = "expo-image";
const IMAGE_IMPORT_NAME = "Image";

const getJsxMemberRootName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null => {
  if (isNodeOfType(node.object, "JSXIdentifier")) return node.object.name;
  if (isNodeOfType(node.object, "JSXMemberExpression")) return getJsxMemberRootName(node.object);
  return null;
};

const getJsxMemberPropertyName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null => {
  if (isNodeOfType(node.property, "JSXIdentifier")) return node.property.name;
  return null;
};

export const preferOptimizedImage = defineRule<Rule>({
  id: "prefer-optimized-image",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `<Image>` from `expo-image` instead of `react-native` Image in Expo apps for caching, placeholders, and progressive loading",
  create: (context: RuleContext) => {
    if (!isExpoManagedFileActive(context)) return EMPTY_VISITORS;

    const reactNativeNamespaceNames = new Set<string>();

    const collectReactNativeNamespaceImports = (
      node: EsTreeNodeOfType<"ImportDeclaration">,
    ): void => {
      if (node.source?.value !== REACT_NATIVE_PACKAGE_NAME) return;
      if (node.importKind === "type") return;

      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportNamespaceSpecifier")) continue;
        reactNativeNamespaceNames.add(specifier.local.name);
      }
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        for (const statement of node.body ?? []) {
          if (!isNodeOfType(statement, "ImportDeclaration")) continue;
          collectReactNativeNamespaceImports(statement);
        }
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== REACT_NATIVE_PACKAGE_NAME) return;
        if (node.importKind === "type") return;

        collectReactNativeNamespaceImports(node);

        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (specifier.importKind === "type") continue;
          if (getImportedName(specifier) !== IMAGE_IMPORT_NAME) continue;

          context.report({
            node: specifier,
            message: `Importing Image from react-native in an Expo app: use Image from ${EXPO_IMAGE_PACKAGE_NAME} for caching, placeholders, and progressive loading`,
          });
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXMemberExpression")) return;

        const rootName = getJsxMemberRootName(node.name);
        const propertyName = getJsxMemberPropertyName(node.name);
        if (!rootName || propertyName !== IMAGE_IMPORT_NAME) return;
        if (!reactNativeNamespaceNames.has(rootName)) return;

        context.report({
          node: node.name,
          message: `Rendering react-native Image in an Expo app: use Image from ${EXPO_IMAGE_PACKAGE_NAME} for caching, placeholders, and progressive loading`,
        });
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover ingest-knowledge` + `rde discover draft` (v3 knowledge-aware prompt: AST-detectability check + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline.
</sub>
