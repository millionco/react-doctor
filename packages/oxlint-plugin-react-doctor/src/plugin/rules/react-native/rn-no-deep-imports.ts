import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const DEEP_IMPORT_PREFIX = "react-native/Libraries/";

// Moved to its own package in RN 0.80; the old deep path is removed.
const NEW_APP_SCREEN_PATH = "react-native/Libraries/NewAppScreen";

// Public React Native exports that some code reaches for via the internal
// `react-native/Libraries/...` subpath. Each of these is re-exported from
// the package root, so "import it from 'react-native'" is always correct
// advice. We deliberately key off this curated set (matched on the deep
// path's final segment) rather than flagging the whole `Libraries/` tree:
// the OSS corpus showed most deep imports are Codegen specs
// (`TurboModule/RCTExport`, `Types/CodegenTypes`), type-only imports of
// types NOT exported from root (`StyleSheetTypes`), or genuinely-internal
// modules (`resolveAssetSource`, `PolyfillFunctions`) that have no root
// equivalent — flagging those would give wrong advice. RFC 0894 deprecates
// all subpath imports; this rule starts with the unambiguous, correctly-
// fixable subset.
//
// Namespace modules whose *sub-exports* aren't individually re-exported from
// the root are deliberately excluded — e.g. `Animated/Easing` exposes
// `linear`/`ease`, but the root only exports the `Easing` object, so
// `import { linear } from "react-native"` would not resolve.
const PUBLIC_RN_ROOT_EXPORTS = new Set<string>([
  "View",
  "Text",
  "Image",
  "ImageBackground",
  "ScrollView",
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "TextInput",
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
  "Button",
  "Switch",
  "Modal",
  "ActivityIndicator",
  "RefreshControl",
  "KeyboardAvoidingView",
  "StyleSheet",
  "Alert",
  "Animated",
  "Platform",
  "Dimensions",
  "AppRegistry",
  "AppState",
  "Linking",
  "Appearance",
  "Keyboard",
  "StatusBar",
  "PixelRatio",
  "PanResponder",
  "BackHandler",
  "InteractionManager",
]);

const lastPathSegment = (source: string): string => {
  const segments = source.split("/");
  return segments[segments.length - 1] ?? "";
};

interface DeepImportFinding {
  readonly message: string;
}

// Classifies a module source string into a finding, or null when it's not
// a deep import we flag in v1 (root imports, internal-only modules, tooling
// subpaths like `react-native/jest-preset` that aren't under `Libraries/`).
const classifyDeepImport = (source: unknown): DeepImportFinding | null => {
  if (typeof source !== "string") return null;
  if (!source.startsWith(DEEP_IMPORT_PREFIX)) return null;

  if (source === NEW_APP_SCREEN_PATH || source.startsWith(`${NEW_APP_SCREEN_PATH}/`)) {
    return {
      message:
        "`react-native/Libraries/NewAppScreen` was moved out of core in React Native 0.80; import from `@react-native/new-app-screen` instead.",
    };
  }

  // Match on the deep path's final segment. The message stays generic
  // (it doesn't name a symbol) because a leaf module re-exports both its
  // component AND associated types from the root — e.g.
  // `react-native/Libraries/Components/ScrollView/ScrollView` is the source
  // of both `ScrollView` and the `NativeScrollEvent` type, all available
  // from `"react-native"`. Naming `ScrollView` would be wrong when the user
  // imported the type.
  const exportName = lastPathSegment(source);
  if (PUBLIC_RN_ROOT_EXPORTS.has(exportName)) {
    return {
      message: `Deep import from "${source}" is a deprecated React Native internal subpath (RFC 0894) and breaks on upgrade. Import from "react-native" instead.`,
    };
  }
  return null;
};

// HACK: RFC 0894 deprecates subpath imports into `react-native/Libraries/*`;
// React Native 0.80 already emits ESLint + console warnings, and a future
// `"exports"` map will hard-remove these paths (the import then throws
// "module not found"). v1 only flags deep imports of symbols that ARE
// re-exported from the `react-native` root (so the fix is a safe one-line
// change) plus the relocated `NewAppScreen`. Type-only imports are skipped
// because many RN internal types are not exported from the root.
// True when every specifier on the declaration is an inline type-only
// specifier (`import { type A, type B } from "..."`) — i.e. the whole import
// is type-only even though `node.importKind` is `"value"`. A default/namespace
// specifier, a value specifier, or no specifiers at all (a bare side-effect
// import) make this false. Mirrors the declaration-level `import type` skip so
// the two forms behave identically. `kindField` is `importKind` for imports
// and `exportKind` for named re-exports.
const isEverySpecifierInlineType = (
  specifiers: ReadonlyArray<EsTreeNode> | undefined,
  specifierType: "ImportSpecifier" | "ExportSpecifier",
  kindField: "importKind" | "exportKind",
): boolean => {
  if (!specifiers || specifiers.length === 0) return false;
  return specifiers.every(
    (specifier) =>
      isNodeOfType(specifier, specifierType) &&
      (specifier as { [key: string]: unknown })[kindField] === "type",
  );
};

export const rnNoDeepImports = defineRule<Rule>({
  id: "rn-no-deep-imports",
  title: "Deep import into react-native internals",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Import the symbol from `react-native` (the package root) instead of the deprecated `react-native/Libraries/...` subpath, which RFC 0894 removes on upgrade.",
  create: (context: RuleContext) => {
    const reportFinding = (node: EsTreeNode, source: unknown): void => {
      const finding = classifyDeepImport(source);
      if (finding) context.report({ node, message: finding.message });
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        // Skip type-only imports — both `import type { ... }` and the inline
        // `import { type A, type B } from "..."` form. Many RN internal *types*
        // are not re-exported from the root, so "import from react-native"
        // would be wrong advice. A mixed `import { Value, type T }` still has a
        // value specifier, so it is NOT skipped.
        if (node.importKind === "type") return;
        if (isEverySpecifierInlineType(node.specifiers, "ImportSpecifier", "importKind")) return;
        reportFinding(node, node.source?.value);
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (node.exportKind === "type") return;
        // `source` is only set for re-exports (`export { x } from "..."`).
        if (!node.source) return;
        if (isEverySpecifierInlineType(node.specifiers, "ExportSpecifier", "exportKind")) return;
        reportFinding(node, node.source.value);
      },
      ExportAllDeclaration(node: EsTreeNodeOfType<"ExportAllDeclaration">) {
        if (node.exportKind === "type") return;
        reportFinding(node, node.source?.value);
      },
    };
  },
});
