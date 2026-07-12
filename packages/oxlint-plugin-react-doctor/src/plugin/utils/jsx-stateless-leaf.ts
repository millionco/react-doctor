import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Pure-presentational SVG primitives — no DOM state, no event-bound
// identity. Reorder hazards (e.g. index keys) don't apply because
// there's nothing to "lose" if React maps the wrong index to the
// wrong element; the attributes get re-diffed regardless.
export const PURE_SVG_PRIMITIVE_TAGS: ReadonlySet<string> = new Set([
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "stop",
  "text",
  "tspan",
  "defs",
  "use",
  "mask",
  "marker",
  "linearGradient",
  "radialGradient",
  "clipPath",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feMerge",
  "feMergeNode",
  "feColorMatrix",
  "feFlood",
  "feComposite",
  "title",
  "desc",
]);

// Plain-display HTML elements with no DOM-managed state. Reorder
// hazards only matter when their CHILDREN have state — see
// `containsStatefulDescendant` below.
export const STATELESS_HTML_LEAF_TAGS: ReadonlySet<string> = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "footer",
  "section",
  "article",
  "aside",
  "main",
  "nav",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "tfoot",
  "table",
  "caption",
  "colgroup",
  "col",
  "strong",
  "em",
  "small",
  "b",
  "i",
  "u",
  "s",
  "mark",
  "del",
  "ins",
  "sub",
  "sup",
  "abbr",
  "cite",
  "code",
  "kbd",
  "samp",
  "pre",
  "blockquote",
  "q",
  "br",
  "hr",
  "wbr",
  "figure",
  "figcaption",
  "label",
  "legend",
  "fieldset",
  "address",
  "time",
  "data",
  "var",
  "ruby",
  "rt",
  "rp",
  "bdi",
  "bdo",
]);

// HTML elements that manage DOM state (selection / focus / scroll /
// playback / interactive identity). Reordering with an index key
// corrupts that state.
const STATEFUL_HTML_DESCENDANT_TAGS: ReadonlySet<string> = new Set([
  "input",
  "textarea",
  "select",
  "option",
  "optgroup",
  "button",
  "form",
  "output",
  "progress",
  "meter",
  "video",
  "audio",
  "source",
  "track",
  // Media with network-load state — reordering index-keyed images
  // re-fetches and flickers, and can show the wrong image transiently.
  "img",
  "picture",
  "iframe",
  "embed",
  "object",
  "a",
  "details",
  "summary",
  "dialog",
  "canvas",
]);

const STATEFUL_HTML_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "autofocus",
  "contenteditable",
  "draggable",
  "tabindex",
]);

const isStaticallyFalseAttributeValue = (attribute: EsTreeNode): boolean => {
  if (!isNodeOfType(attribute, "JSXAttribute") || !attribute.value) return false;
  const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? attribute.value.expression
    : attribute.value;
  return isNodeOfType(value, "Literal") && (value.value === false || value.value === "false");
};

const hasStatefulHtmlAttribute = (openingElement: EsTreeNode): boolean => {
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  return openingElement.attributes.some((attribute) => {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier")
    ) {
      return false;
    }
    const attributeName = attribute.name.name.toLowerCase();
    if (!STATEFUL_HTML_ATTRIBUTE_NAMES.has(attributeName)) return false;
    return attributeName === "tabindex" || !isStaticallyFalseAttributeValue(attribute);
  });
};

const STATEFUL_DESCENDANT_SCAN_BUDGET = 200;

interface RowContentScanOptions {
  // Member reads rooted at these names (`{token.text}` where `token` is
  // the iteration item) are row content that travels with the row.
  memberRootNames?: ReadonlySet<string>;
  // Fragments: ANY member read is display text, not external state.
  allowAnyMemberRead?: boolean;
  // Bare identifiers treated as row content (item-derived locals like a
  // recursive renderer's `children`, or the bare item in text runs).
  bareIdentifierNames?: ReadonlySet<string>;
  // Calls whose callee roots at these names (`{fn(...)}` where `fn` IS
  // the iteration item) are renderer-list content.
  callCalleeRootNames?: ReadonlySet<string>;
}

const rootIdentifierNameOf = (expression: EsTreeNode): string | null => {
  let object: EsTreeNode = expression;
  while (isNodeOfType(object, "MemberExpression")) object = object.object as EsTreeNode;
  return isNodeOfType(object, "Identifier") ? object.name : null;
};

// Walks the JSXElement subtree looking for stateful descendants —
// form controls, media, interactive containers, custom (PascalCase)
// components, or unknown function-call/identifier-yielding children.
// Returns true (conservative) when any are found. Expressions matching
// `options` are exempt: they are data carried by the row itself, not
// stateful UI.
export const containsStatefulDescendant = (
  jsxElement: EsTreeNode,
  options: RowContentScanOptions = {},
): boolean => {
  const memberRootNames = options.memberRootNames ?? new Set<string>();
  const bareIdentifierNames = options.bareIdentifierNames ?? new Set<string>();
  const callCalleeRootNames = options.callCalleeRootNames ?? new Set<string>();
  let budget = STATEFUL_DESCENDANT_SCAN_BUDGET;
  const stack: Array<EsTreeNode> = [jsxElement];
  while (stack.length > 0) {
    if (budget <= 0) return true; // Bail-out: assume stateful.
    budget -= 1;
    const node = stack.pop()!;
    if (isNodeOfType(node, "JSXElement")) {
      const opening = (node as { openingElement: EsTreeNode }).openingElement;
      const name = (opening as { name?: EsTreeNode }).name;
      if (name && isNodeOfType(name, "JSXIdentifier")) {
        const tagName = name.name;
        const firstChar = tagName.charCodeAt(0);
        const isUppercase = firstChar >= 65 && firstChar <= 90;
        // PascalCase custom component — unknown state, treat as stateful.
        if (isUppercase) return true;
        if (STATEFUL_HTML_DESCENDANT_TAGS.has(tagName)) return true;
      }
      // Member-expression JSX (e.g. `<Foo.Bar />`) — custom; stateful.
      if (name && isNodeOfType(name, "JSXMemberExpression")) return true;
      if (hasStatefulHtmlAttribute(opening)) return true;
      const children = (node as { children?: ReadonlyArray<EsTreeNode> }).children ?? [];
      for (const child of children) stack.push(child);
      continue;
    }
    if (isNodeOfType(node, "JSXFragment")) {
      const children = (node as { children?: ReadonlyArray<EsTreeNode> }).children ?? [];
      for (const child of children) stack.push(child);
      continue;
    }
    if (isNodeOfType(node, "JSXExpressionContainer")) {
      const expression = node.expression as EsTreeNode;
      if (isNodeOfType(expression, "MemberExpression")) {
        if (options.allowAnyMemberRead === true) continue;
        const rootName = rootIdentifierNameOf(expression);
        if (rootName !== null && memberRootNames.has(rootName)) continue;
        return true;
      }
      if (isNodeOfType(expression, "Identifier")) {
        if (bareIdentifierNames.has(expression.name)) continue;
        return true;
      }
      if (isNodeOfType(expression, "CallExpression")) {
        const callee = expression.callee as EsTreeNode;
        if (isNodeOfType(callee, "Identifier") && callCalleeRootNames.has(callee.name)) continue;
        return true;
      }
      stack.push(expression);
      continue;
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      stack.push(node.consequent as EsTreeNode, node.alternate as EsTreeNode);
      continue;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
      stack.push(node.left as EsTreeNode, node.right as EsTreeNode);
      continue;
    }
    // JSXText / Literal — pure content, never stateful.
  }
  return false;
};
