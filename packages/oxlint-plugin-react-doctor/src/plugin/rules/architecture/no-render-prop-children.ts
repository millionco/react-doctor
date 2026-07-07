import { RENDER_PROP_PROLIFERATION_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const RENDER_PROP_PATTERN = /^render[A-Z]/;

// First-party sources: relative/absolute paths and the common `@/`, `~/`,
// `#` path aliases. Everything else (bare package specifiers, `@scope/pkg`,
// webpack-convention `~pkg`) resolves to a dependency whose props API the
// call site cannot restructure — the fix (compound components / children)
// only exists for the component's author.
const isExternalModuleSource = (source: string): boolean =>
  !source.startsWith(".") &&
  !source.startsWith("/") &&
  !source.startsWith("@/") &&
  !source.startsWith("~/") &&
  !source.startsWith("#");

const getRootJsxIdentifierName = (name: EsTreeNode): string | null => {
  let current = name;
  while (isNodeOfType(current, "JSXMemberExpression")) {
    current = current.object as EsTreeNode;
  }
  return isNodeOfType(current, "JSXIdentifier") ? current.name : null;
};

const isThirdPartyComponent = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const rootName = getRootJsxIdentifierName(node.name as EsTreeNode);
  if (!rootName) return false;
  const importSource = getImportSourceForName(node as EsTreeNode, rootName);
  if (!importSource) return false;
  return isExternalModuleSource(importSource);
};

// A render prop hands a render slot (a function/JSX node) to the child. Two
// `render*`-prefixed shapes are NOT render slots and must not inflate the count:
//   - a `render*Props` config bag (e.g. react-pdf's `renderTextLayerProps`,
//     `renderAnnotationLayerProps`) is an options object passed to a layer, and
//   - a data literal value (e.g. `renderMode="canvas"`, `renderable={false}`) is
//     a mode/flag, not a render function.
// Counting either misreads a plain forwarding component as render-prop
// proliferation.
const looksLikeRenderSlot = (attr: EsTreeNodeOfType<"JSXAttribute">, name: string): boolean => {
  if (name.endsWith("Props")) return false;
  if (attr.value === null) return false;
  if (isNodeOfType(attr.value, "Literal")) return false;
  if (
    isNodeOfType(attr.value, "JSXExpressionContainer") &&
    isNodeOfType(attr.value.expression, "Literal")
  ) {
    return false;
  }
  return true;
};

// HACK: render-prop proliferation (`<Foo renderHeader={…} renderFooter={…}
// renderActions={…} />`) is the smell — a single render-prop is often
// the legitimate library API (MUI Autocomplete's `renderInput`, FlatList's
// `renderItem`, react-hook-form's Controller `render`, etc.) and we
// shouldn't fire on those. Instead we flag the COMPOUND case: when a
// single element receives 3 or more `render*` props, that's the smell
// of "many slots cobbled together where compound components or
// `children` would be cleaner".
export const noRenderPropChildren = defineRule({
  id: "no-render-prop-children",
  title: "Render-prop slots make this component hard to extend",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Swap `renderXxx` props for child components like `<Modal.Header>` or plain `children`, so the parent doesn't control every slot.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const renderPropAttrs: Array<{ name: string; node: EsTreeNode }> = [];
      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
        const name = attr.name.name;
        if (!RENDER_PROP_PATTERN.test(name)) continue;
        if (!looksLikeRenderSlot(attr, name)) continue;
        renderPropAttrs.push({ name, node: attr });
      }
      if (renderPropAttrs.length < RENDER_PROP_PROLIFERATION_THRESHOLD) return;
      if (isThirdPartyComponent(node)) return;

      const propList = renderPropAttrs
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(", ");
      context.report({
        node: renderPropAttrs[0].node,
        message: `This element takes ${renderPropAttrs.length} render props (${propList}…), which is hard to follow & extend. Use child components or \`children\` so callers don't wire up every slot.`,
      });
    },
  }),
});
