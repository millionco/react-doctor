import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// oxc-parser surfaces `(...)` as a node kind outside the TSESTree union,
// so it is matched via a `string`-typed constant.
const PARENTHESIZED_EXPRESSION: string = "ParenthesizedExpression";
const ESCAPE_ASSIGNMENT_TARGET_PROPERTIES = new Set(["href", "src", "current"]);

const MESSAGE =
  "`URL.createObjectURL(...)` pins the underlying Blob/File in memory until it is revoked, and this module never calls `URL.revokeObjectURL`. Store the URL, revoke it once you're done (in an effect cleanup, after the download, or on unmount) so the Blob can be freed.";

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};

const isCreateObjectUrlCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "createObjectURL") {
    return false;
  }
  const object = callee.object;
  if (isNodeOfType(object, "Identifier")) {
    if (object.name !== "URL") return false;
    // A same-file binding named `URL` (import or local class) is not the
    // DOM global, whose `createObjectURL` is the only leaky surface.
    if (findVariableInitializer(object, "URL")) return false;
    return true;
  }
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier")
  ) {
    return object.property.name === "URL";
  }
  return false;
};

const moduleReferencesRevoke = (programRoot: EsTreeNode): boolean => {
  let found = false;
  walkAst(programRoot, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "MemberExpression") && !child.computed) {
      if (isNodeOfType(child.property, "Identifier") && child.property.name === "revokeObjectURL") {
        found = true;
        return false;
      }
    }
    if (isNodeOfType(child, "Identifier") && child.name === "revokeObjectURL") {
      found = true;
      return false;
    }
  });
  return found;
};

interface EscapeContext {
  guarded: boolean;
  topNode: EsTreeNode;
  parent: EsTreeNode | null;
}

const resolveEscapeContext = (callNode: EsTreeNode): EscapeContext => {
  let node = callNode;
  let guarded = false;
  while (true) {
    const parent = meaningfulParent(node);
    if (!parent) break;
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      (stripGroupingParens(parent.left as EsTreeNode) === node ||
        stripGroupingParens(parent.right as EsTreeNode) === node)
    ) {
      guarded = true;
      node = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (stripGroupingParens(parent.consequent as EsTreeNode) === node ||
        stripGroupingParens(parent.alternate as EsTreeNode) === node)
    ) {
      guarded = true;
      node = parent;
      continue;
    }
    break;
  }
  return { guarded, topNode: node, parent: meaningfulParent(node) };
};

const isStateSetterCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "Identifier") && /^set[A-Z]/.test(callee.name);

const escapeIsLeaky = (context: EscapeContext): boolean => {
  const { guarded, topNode, parent } = context;
  if (!parent) return false;

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    stripGroupingParens(parent.right as EsTreeNode) === topNode
  ) {
    const target = parent.left;
    if (
      isNodeOfType(target, "MemberExpression") &&
      !target.computed &&
      isNodeOfType(target.property, "Identifier") &&
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(target.property.name)
    ) {
      return true;
    }
    return false;
  }

  if (isNodeOfType(parent, "ReturnStatement")) return true;

  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    stripGroupingParens(parent.body as EsTreeNode) === topNode
  ) {
    return true;
  }

  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.parent) {
    return isNodeOfType(parent.parent, "JSXAttribute");
  }

  // A conditional/logical creation stored in a variable is the
  // "object URL for fetched data, kept in state" leak; an unguarded
  // `const x = URL.createObjectURL(file)` is the ambiguous
  // avatar/preview case the spec keeps quiet.
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    stripGroupingParens((parent.init as EsTreeNode) ?? topNode) === topNode
  ) {
    return guarded;
  }

  // Passed directly to a state setter (`setImageUrl(URL.createObjectURL(...))`).
  if (isNodeOfType(parent, "CallExpression") && isStateSetterCallee(parent.callee)) {
    return true;
  }

  return false;
};

// Flags `URL.createObjectURL(...)` whose produced URL escapes (assigned to
// an element `href`/`src`, stored into a ref, returned, rendered inline in
// JSX, passed to a state setter, or a guarded value bound to a variable)
// when the module never references `URL.revokeObjectURL`. The blob URL
// pins its Blob/File in memory until revoked, so an un-revoked URL leaks.
export const noCreateObjectUrlWithoutRevoke = defineRule({
  id: "no-create-object-url-without-revoke",
  title: "createObjectURL without revokeObjectURL",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Call `URL.revokeObjectURL(url)` once the object URL is no longer needed (after the download, in a `useEffect` cleanup, or on unmount). An object URL keeps its Blob/File alive for the document lifetime until it is revoked.",
  create: (context: RuleContext) => {
    const skipFile = isTestlikeFilename(context.filename);
    let moduleHasRevoke = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        if (skipFile) return;
        moduleHasRevoke = moduleReferencesRevoke(node as EsTreeNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (skipFile || moduleHasRevoke) return;
        if (!isCreateObjectUrlCall(node)) return;
        const escape = resolveEscapeContext(node as EsTreeNode);
        if (!escapeIsLeaky(escape)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
