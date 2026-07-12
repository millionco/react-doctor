import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../utils/unwrap-discarded-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "reduce",
  "reduceRight",
]);

const LAYOUT_FORCING_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
]);

const LAYOUT_FORCING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "getBoundingClientRect",
  "getClientRects",
  "getComputedStyle",
]);

// Compositor/paint-only properties: writing them never invalidates
// layout, so a run of these writes (FLIP phase, fade choreography)
// cannot cause the repeated recalculation this rule claims.
const LAYOUT_NEUTRAL_STYLE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "transform",
  "opacity",
  "transition",
  "transitionProperty",
  "transitionDuration",
  "transitionDelay",
  "transitionTimingFunction",
  "willChange",
  "animation",
  "animationName",
  "animationDuration",
  "animationDelay",
  "animationPlayState",
  "filter",
  "backdropFilter",
  "boxShadow",
  "zIndex",
  "pointerEvents",
  "cursor",
]);

const DOM_CREATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "createElement",
  "createElementNS",
  "createDocumentFragment",
  "cloneNode",
  "importNode",
]);

const DETACHED_SUBTREE_QUERY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementsByTagName",
  "getElementsByClassName",
]);

const DOM_ATTACHMENT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "appendChild",
  "append",
  "prepend",
  "insertBefore",
  "replaceChild",
  "replaceChildren",
  "before",
  "after",
  "replaceWith",
]);

// True when `fn` is the per-item callback of a known array iteration:
// receiver-method form (`arr.map(fn)` / `.forEach(fn)` / `.reduce(fn)`
// / etc.) where the callback is the first argument, OR
// `Array.from(iterable, fn)` where it's the second.
const isIteratorCallback = (fn: EsTreeNode): boolean => {
  const functionParent = fn.parent;
  if (!functionParent || !isNodeOfType(functionParent, "CallExpression")) return false;
  const callee = functionParent.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (functionParent.arguments[0] === fn && ITERATOR_METHOD_NAMES.has(callee.property.name)) {
    return true;
  }
  if (
    functionParent.arguments[1] === fn &&
    callee.property.name === "from" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array"
  ) {
    return true;
  }
  return false;
};

// The statement list executed once per iteration: the body of the
// nearest enclosing loop statement or iterator callback. Crossing a
// non-iterator function boundary (event handler arrow, setTimeout
// callback, etc.) stops the walk: that function's body runs in its own
// per-invocation scope, not per-iteration of the outer loop.
const findEnclosingPerIterationBody = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return (current.body as EsTreeNode | null) ?? null;
    }
    if (isFunctionLike(current)) {
      if (isIteratorCallback(current)) {
        return (current.body as EsTreeNode | null) ?? null;
      }
      return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

const unwrapValueParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (
    parent &&
    (isNodeOfType(parent, "ChainExpression") || parent.type === "TSNonNullExpression")
  ) {
    parent = parent.parent ?? null;
  }
  return parent;
};

// The expression whose value carries the layout measurement: the
// CallExpression for method reads (`el.getBoundingClientRect()`), the
// MemberExpression itself for property reads (`el.offsetHeight`).
const getLayoutReadValueNode = (node: EsTreeNode): EsTreeNode | null => {
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "getComputedStyle"
  ) {
    return node;
  }
  if (!isNodeOfType(node, "MemberExpression") || !isNodeOfType(node.property, "Identifier")) {
    return null;
  }
  const memberName = node.property.name;
  if (LAYOUT_FORCING_METHOD_NAMES.has(memberName)) {
    const parent = unwrapValueParent(node);
    if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === node) return parent;
    return null;
  }
  if (!LAYOUT_FORCING_PROPERTY_NAMES.has(memberName)) return null;
  const parent = unwrapValueParent(node);
  if (parent && isNodeOfType(parent, "AssignmentExpression") && parent.left === node) return null;
  return node;
};

const isDiscardedValue = (valueNode: EsTreeNode): boolean => {
  const parent = unwrapValueParent(valueNode);
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") {
    const grandparent = parent.parent ?? null;
    return Boolean(grandparent && isNodeOfType(grandparent, "ExpressionStatement"));
  }
  return false;
};

interface PerIterationLayoutReads {
  hasUsedLayoutRead: boolean;
  hasDeliberateForcedReflow: boolean;
}

// Scans one loop iteration's body for forced-layout reads. A USED read
// (`const h = el.offsetHeight`) interleaved with style writes is the
// genuine thrash signal. A DISCARDED read (`el.getBoundingClientRect();`
// or `void el.offsetHeight;`) is the signature of a deliberate forced
// reflow (FLIP animations, measure-restore helpers) — batching those
// writes would break the technique, so its presence vetoes the report.
// The used-read scan stops at nested function boundaries (their bodies
// don't run per-iteration); the veto scan descends everywhere since it
// only ever suppresses.
const scanPerIterationLayoutReads = (body: EsTreeNode): PerIterationLayoutReads => {
  let hasUsedLayoutRead = false;
  let hasDeliberateForcedReflow = false;
  walkAst(body, (child: EsTreeNode): boolean | void => {
    const isNestedFunction = child !== body && isFunctionLike(child);
    const valueNode = getLayoutReadValueNode(child);
    if (valueNode) {
      if (isDiscardedValue(valueNode)) {
        hasDeliberateForcedReflow = true;
      } else if (!isNestedFunction) {
        hasUsedLayoutRead = true;
      }
    }
    if (isNestedFunction) {
      walkAst(child, (nested: EsTreeNode) => {
        const nestedValueNode = getLayoutReadValueNode(nested);
        if (nestedValueNode && isDiscardedValue(nestedValueNode)) {
          hasDeliberateForcedReflow = true;
        }
      });
      return false;
    }
  });
  return { hasUsedLayoutRead, hasDeliberateForcedReflow };
};

const getNodeStart = (node: EsTreeNode): number => {
  const withRange = node as { range?: [number, number] };
  return withRange.range ? withRange.range[0] : -1;
};

const isDomCreationCall = (initializer: EsTreeNode | null): boolean => {
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const callee = initializer.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    DOM_CREATION_METHOD_NAMES.has(callee.property.name)
  );
};

interface DetachedCreationRoot {
  rootName: string;
  scopeOwner: EsTreeNode;
}

const MAX_DETACHED_ROOT_RESOLUTION_DEPTH = 4;

// Resolves an element expression back to the same-file binding that
// created its subtree root, following one-hop lookups that stay inside
// that subtree: `clonedImages[index]` → `container.querySelectorAll(…)`
// → `document.createElement("div")`. Elements found inside a detached
// root stay detached until the ROOT is inserted, so attachment is
// checked against the root binding.
const resolveDetachedCreationRoot = (
  expression: EsTreeNode,
  depth: number,
): DetachedCreationRoot | null => {
  if (depth > MAX_DETACHED_ROOT_RESOLUTION_DEPTH) return null;
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding?.initializer) return null;
  const initializer = stripParenExpression(binding.initializer);
  if (isDomCreationCall(initializer)) {
    return { rootName: stripped.name, scopeOwner: binding.scopeOwner };
  }
  if (
    isNodeOfType(initializer, "CallExpression") &&
    isNodeOfType(initializer.callee, "MemberExpression") &&
    isNodeOfType(initializer.callee.property, "Identifier") &&
    DETACHED_SUBTREE_QUERY_METHOD_NAMES.has(initializer.callee.property.name)
  ) {
    return resolveDetachedCreationRoot(initializer.callee.object as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(initializer, "MemberExpression")) {
    return resolveDetachedCreationRoot(initializer.object as EsTreeNode, depth + 1);
  }
  return null;
};

const hasAttachmentBefore = (
  scopeOwner: EsTreeNode,
  elementName: string,
  beforeStart: number,
): boolean => {
  let foundAttachment = false;
  walkAst(scopeOwner, (child: EsTreeNode): boolean | void => {
    if (foundAttachment) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(callee.property, "Identifier") ||
      !DOM_ATTACHMENT_METHOD_NAMES.has(callee.property.name)
    ) {
      return;
    }
    const referencesElement = child.arguments.some(
      (argument) => isNodeOfType(argument, "Identifier") && argument.name === elementName,
    );
    if (referencesElement && getNodeStart(child) < beforeStart) {
      foundAttachment = true;
      return false;
    }
  });
  return foundAttachment;
};

const getStyleAssignment = (node: EsTreeNode): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  if (!isNodeOfType(node, "ExpressionStatement")) return null;
  const expression = unwrapDiscardedExpression(node);
  if (!isNodeOfType(expression, "AssignmentExpression")) return null;
  if (!isNodeOfType(expression.left, "MemberExpression")) return null;
  if (!isNodeOfType(expression.left.object, "MemberExpression")) return null;
  if (!isNodeOfType(expression.left.object.property, "Identifier")) return null;
  return expression.left.object.property.name === "style" ? expression : null;
};

// Style writes on an element that is not in the document dirty nothing —
// no live layout exists to recalculate. When the receiver resolves to a
// same-file `createElement` / `cloneNode` / etc. binding and no
// attachment call (`appendChild(el)`, `parent.replaceChild(el, …)`, …)
// precedes the write, the write is provably reflow-free.
const isProvablyDetachedAtWrite = (styleWriteStatement: EsTreeNode): boolean => {
  const assignment = getStyleAssignment(styleWriteStatement);
  if (
    !assignment ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    !isNodeOfType(assignment.left.object, "MemberExpression")
  ) {
    return false;
  }
  const elementExpression = assignment.left.object.object;
  const creationRoot = resolveDetachedCreationRoot(elementExpression as EsTreeNode, 0);
  if (!creationRoot) return false;
  return !hasAttachmentBefore(
    creationRoot.scopeOwner,
    creationRoot.rootName,
    getNodeStart(styleWriteStatement),
  );
};

export const jsBatchDomCss = defineRule({
  id: "js-batch-dom-css",
  title: "Repeated inline style writes",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Do all your reads first, then all your writes. Mixing them inside a loop makes the browser recalculate the layout again and again, which is slow",
  create: (context: RuleContext) => {
    const writesLayoutAffectingProperty = (node: EsTreeNode): boolean => {
      const assignment = getStyleAssignment(node);
      return (
        assignment !== null &&
        isNodeOfType(assignment.left, "MemberExpression") &&
        isNodeOfType(assignment.left.property, "Identifier") &&
        !LAYOUT_NEUTRAL_STYLE_PROPERTY_NAMES.has(assignment.left.property.name)
      );
    };

    return {
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        const perIterationBody = findEnclosingPerIterationBody(node);
        if (!perIterationBody) return;
        const statements = node.body ?? [];
        let layoutReads: PerIterationLayoutReads | null = null;
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            getStyleAssignment(statements[statementIndex]) === null ||
            getStyleAssignment(statements[statementIndex - 1]) === null
          ) {
            continue;
          }
          if (
            !writesLayoutAffectingProperty(statements[statementIndex]) &&
            !writesLayoutAffectingProperty(statements[statementIndex - 1])
          ) {
            continue;
          }
          layoutReads ??= scanPerIterationLayoutReads(perIterationBody);
          if (!layoutReads.hasUsedLayoutRead || layoutReads.hasDeliberateForcedReflow) return;
          if (isProvablyDetachedAtWrite(statements[statementIndex])) continue;
          context.report({
            node: statements[statementIndex],
            message:
              "This makes the browser recalculate layout again & again because element.style writes are interleaved with layout reads inside a loop, so do all reads first, then set the styles at once with cssText or a CSS class",
          });
        }
      },
    };
  },
});
