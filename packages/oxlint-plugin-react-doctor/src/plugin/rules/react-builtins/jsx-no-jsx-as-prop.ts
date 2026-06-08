import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "This child redraws every render because the prop gets brand new JSX each time.";

// Prop names that conventionally receive single JSX elements (icons,
// slot content, fallbacks, render props). For these the inline JSX
// IS the canonical pattern — every shadcn / Radix / MUI / Mantine /
// Chakra / tldraw / Excalidraw component has an `icon`, `tooltip`,
// `header`, `fallback`, etc. slot. Flagging them creates massive
// noise for design-system consumers without any actionable signal.
const KNOWN_SLOT_PROP_NAMES: ReadonlySet<string> = new Set([
  // Icon slots
  "icon",
  "Icon",
  "iconLeft",
  "iconRight",
  "leftIcon",
  "rightIcon",
  "startIcon",
  "endIcon",
  "prefixIcon",
  "suffixIcon",
  "iconBefore",
  "iconAfter",
  // Generic content slots
  "prefix",
  "suffix",
  "before",
  "after",
  "header",
  "footer",
  "title",
  "subtitle",
  "description",
  "caption",
  "label",
  "labelExtra",
  "tooltip",
  "trigger",
  "triggerContent",
  "content",
  "body",
  "action",
  "actions",
  "controls",
  "placeholder",
  "endAdornment",
  "startAdornment",
  "leftSection",
  "rightSection",
  "addonBefore",
  "addonAfter",
  "selectButton",
  "badge",
  "message",
  // Info / help slots — receive JSX explanation/help/preview content
  "info",
  "infoMessage",
  "help",
  "helpText",
  "helpTooltip",
  "avatar",
  "preview",
  "adornment",
  "callToAction",
  "extraControls",
  "contextualText",
  "topHeading",
  "topContent",
  "bottomContent",
  "leftContent",
  "rightContent",
  // Generic JSX-receiving slots (corpus-derived)
  "value",
  "currentValue",
  "form",
  "text",
  "count",
  "modal",
  "rightOptions",
  "leftOptions",
  "titleHelper",
  "inputDisplay",
  "outputDisplay",
  "animatedSvg",
  "Status",
  "additionalEmptyState",
  // Directional / positional slots (`left`, `right`, `top`, `bottom`,
  // `aside`, `details`, `extra`) — flexbox-aware design systems use
  // these to control layout of slot children.
  "left",
  "right",
  "top",
  "bottom",
  "start",
  "end",
  "aside",
  "details",
  "extra",
  "overlay",
  "emptyState",
  "element",
  // Fallback / error slots
  "fallback",
  "fallbackRender",
  "FallbackComponent",
  "ErrorFallback",
  "loadingFallback",
  "loader",
  "errorElement",
  // Common render-prop conventions
  "render",
  "renderItem",
  "renderRow",
  "renderCell",
  "renderEmpty",
  "renderError",
  "renderLoading",
  "renderHeader",
  "renderFooter",
  "renderItemActions",
  "renderName",
  "renderContent",
  "renderTrigger",
  "renderOption",
  // CTA / button slots (common in card/list/toolbar primitives —
  // <ListCard button={<Button>...</Button>}>, <Toolbar
  // primaryButton={<Button>...} secondaryButton={<Button>...}>, etc.)
  "button",
  "primaryButton",
  "secondaryButton",
  "tertiaryButton",
  "leftButton",
  "rightButton",
  "submitButton",
  "cancelButton",
  "closeButton",
  "actionButton",
  "ctaButton",
  "menuButton",
  "iconButton",
  // Dialog / modal slots
  "dialog",
  "drawer",
  "popover",
  "sheet",
  "menu",
  "submenu",
  "dropdown",
  "dropdownContent",
  "dropdownComponents",
  // Toolbar / navigation slots
  "toolbar",
  "toolbarContent",
  "navigation",
  "breadcrumbs",
  "sidebar",
  "topBar",
  "bottomBar",
  // Layout / structural slots
  "container",
  "wrapper",
  "main",
  "section",
  "panel",
  "card",
  "tile",
  "row",
  "column",
  "cell",
  "item",
  "items",
  "list",
  "table",
  "tableHeader",
  "tableFooter",
  // Form / input slots
  "input",
  "inputElement",
  "select",
  "checkbox",
  "radio",
  "switch",
  "field",
  "fieldset",
  "legend",
  "control",
  "controlPanel",
  // Image / media slots
  "image",
  "img",
  "thumbnail",
  "logo",
  "media",
  "cover",
  "banner",
  "hero",
]);

// Suffix patterns that mark a prop as a "slot" — `*Button`, `*Icon`,
// `*Component`, `*Element`, `*Slot`, `*Content`, `*Renderer`, `*Item`,
// `*Trigger`, `*Header`, `*Footer`. Captures the long tail of design
// system slot names (commentsButton / customButton / menuButton /
// iconButton / activeShape / leftComponent / customButton / etc.)
// without enumerating every variation. The receiving prop is by
// convention a single JSX node, not a perf-critical handler.
const SLOT_PROP_SUFFIXES: ReadonlyArray<string> = [
  "Button",
  "Buttons",
  "Icon",
  "Icons",
  "Component",
  "Components",
  "Element",
  "Elements",
  "Slot",
  "Slots",
  "Content",
  "Contents",
  "Renderer",
  "Trigger",
  "Header",
  "Footer",
  "Badge",
  "Label",
  "Tooltip",
  "Indicator",
  "Adornment",
  "Section",
  "Panel",
  "Overlay",
  "Shape",
  // Slot-replacement / customization suffixes
  "Override",
  "Overrides",
  "Items",
  "Item",
  "Action",
  "Actions",
  "Controls",
  "Message",
  "Heading",
  "Details",
  "Preview",
  "Info",
];

const isSlotPropName = (propName: string): boolean => {
  if (KNOWN_SLOT_PROP_NAMES.has(propName)) return true;
  for (const suffix of SLOT_PROP_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const isJsxProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "JSXElement") || isNodeOfType(stripped, "JSXFragment")) return true;
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isJsxProducingExpression(stripped.left) || isJsxProducingExpression(stripped.right);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isJsxProducingExpression(stripped.consequent) || isJsxProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalJsxBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isJsxProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_jsx_as_prop`. Same shape
// as the other react_perf ports; flags `<C jsx={<X />} />` /
// `<C jsx={a || <X />} />` / `<C jsx={a ? a : <X />} />` inside any
// function scope. Also follows render-local identifier bindings
// (`const tree = <X />; return <C jsx={tree} />`) via
// `followsRenderLocalJsxBinding` — hoisted JSX (module scope) is exempt.
export const jsxNoJsxAsProp = defineRule<Rule>({
  id: "jsx-no-jsx-as-prop",
  title: "JSX element passed as a prop",
  tags: ["react-jsx-only"],
  severity: "warn",
  // React Compiler auto-memoizes inline JSX. The perf footgun this rule
  // guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation:
    "Move the JSX outside the component or wrap it in `useMemo` so memoized children do not redraw every render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let memoRegistry: Map<string, MemoStatus> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        memoRegistry = buildSameFileMemoRegistry(node as EsTreeNode);
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements aren't memoized; flagging inline JSX
        // passed as a prop on them is unactionable. See
        // `jsx-no-new-function-as-prop` for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // Same-file plain-function consumer — `React.memo` rationale
        // doesn't apply.
        const parentJsxOpening = node.parent;
        const openingName =
          parentJsxOpening && isNodeOfType(parentJsxOpening, "JSXOpeningElement")
            ? (parentJsxOpening.name as EsTreeNode)
            : null;
        if (memoStatusForJsxOpeningName(memoRegistry, openingName) === "not-memoised") return;
        // Known slot prop names (icon, tooltip, fallback, header, etc.)
        // and slot suffixes (*Button, *Icon, *Component, *Element, ...)
        // are designed to receive JSX. Flagging them is unactionable.
        if (isNodeOfType(node.name, "JSXIdentifier") && isSlotPropName(node.name.name)) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isJsxProducingExpression(expressionNode) &&
          !followsRenderLocalJsxBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
