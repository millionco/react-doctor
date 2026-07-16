import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import {
  PARENTHESIZED_EXPRESSION_TYPE,
  stripGroupingParens,
} from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ESCAPE_ASSIGNMENT_TARGET_PROPERTIES = new Set(["href", "src", "current"]);

const MESSAGE =
  "`URL.createObjectURL(...)` pins the underlying Blob/File in memory until it is revoked, and this module never calls `URL.revokeObjectURL`. Store the URL, revoke it once you're done (in an effect cleanup, after the download, or on unmount) so the Blob can be freed.";

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION_TYPE) parent = parent.parent ?? null;
  return parent;
};

const isCreateObjectUrlCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isMemberProperty(callee, "createObjectURL") || callee.computed) return false;
  const object = stripParenExpression(callee.object);
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
    if (isNodeOfType(child, "Identifier") && child.name === "revokeObjectURL") found = true;
  });
  return found;
};

const MODULE_CACHE_NAME_PATTERN = /cache/i;
const CACHE_COLLECTION_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);
const CACHE_STORE_METHOD_NAMES = new Set(["set", "add"]);

// A cache-named module-scope `new Map()`/`new Set()` the module stores into
// (`previewCache.set(id, url)`) is a deliberate app-lifetime cache: the URLs
// kept there stay in active use across mounts by design (generate once per
// session, reuse forever), so "never revoked" is the intent, not a leak.
const moduleKeepsResultsInModuleScopeCache = (programRoot: EsTreeNode): boolean => {
  if (!isNodeOfType(programRoot, "Program")) return false;
  const cacheBindingNames = new Set<string>();
  for (const statement of programRoot.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!MODULE_CACHE_NAME_PATTERN.test(declarator.id.name)) continue;
      const initializer = declarator.init ? stripGroupingParens(declarator.init) : null;
      if (
        initializer &&
        isNodeOfType(initializer, "NewExpression") &&
        isNodeOfType(initializer.callee, "Identifier") &&
        CACHE_COLLECTION_CONSTRUCTOR_NAMES.has(initializer.callee.name)
      ) {
        cacheBindingNames.add(declarator.id.name);
      }
    }
  }
  if (cacheBindingNames.size === 0) return false;
  let storesIntoCache = false;
  walkAst(programRoot, (child) => {
    if (storesIntoCache) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      !child.callee.computed &&
      isNodeOfType(child.callee.object, "Identifier") &&
      cacheBindingNames.has(child.callee.object.name) &&
      isNodeOfType(child.callee.property, "Identifier") &&
      CACHE_STORE_METHOD_NAMES.has(child.callee.property.name)
    ) {
      storesIntoCache = true;
      return false;
    }
  });
  return storesIntoCache;
};

const isGuardBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    (stripGroupingParens(parent.left) === node || stripGroupingParens(parent.right) === node)) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripGroupingParens(parent.consequent) === node ||
      stripGroupingParens(parent.alternate) === node));

const isStateSetterCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "Identifier") && isSetterIdentifier(callee.name);

const SET_ATTRIBUTE_URL_NAMES = new Set(["href", "src"]);

const isUrlSetAttributeCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  urlArgument: EsTreeNode,
): boolean => {
  const callee = call.callee;
  if (!isMemberProperty(callee, "setAttribute") || callee.computed) return false;
  const [attributeName, attributeValue] = call.arguments;
  if (!attributeName || !attributeValue) return false;
  if (!isNodeOfType(attributeName, "Literal") || typeof attributeName.value !== "string") {
    return false;
  }
  if (!SET_ATTRIBUTE_URL_NAMES.has(attributeName.value)) return false;
  return stripGroupingParens(attributeValue) === urlArgument;
};

const isDirectIfBranchStatement = (assignment: EsTreeNode): boolean => {
  const statement = meaningfulParent(assignment);
  if (!statement || !isNodeOfType(statement, "ExpressionStatement")) return false;
  let container = statement.parent ?? null;
  if (container && isNodeOfType(container, "BlockStatement")) container = container.parent ?? null;
  return container !== null && isNodeOfType(container, "IfStatement");
};

const escapeIsLeaky = (callNode: EsTreeNode): boolean => {
  let topNode = callNode;
  let guarded = false;
  let parent = meaningfulParent(topNode);
  while (parent && isGuardBranchOf(parent, topNode)) {
    guarded = true;
    topNode = parent;
    parent = meaningfulParent(topNode);
  }
  if (!parent) return false;

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    stripGroupingParens(parent.right) === topNode
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
    // The guarded creation assigned to a pre-declared variable is the same
    // "object URL for fetched data" leak as the guarded VariableDeclarator.
    if (isNodeOfType(target, "Identifier")) {
      return guarded || isDirectIfBranchStatement(parent);
    }
    return false;
  }

  if (isNodeOfType(parent, "ReturnStatement")) return true;

  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    stripGroupingParens(parent.body) === topNode
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
    parent.init &&
    stripGroupingParens(parent.init) === topNode
  ) {
    return guarded;
  }

  // Passed directly to a state setter (`setImageUrl(URL.createObjectURL(...))`)
  // or set as an element URL attribute (`a.setAttribute('href', ...)`).
  if (isNodeOfType(parent, "CallExpression")) {
    if (isStateSetterCallee(parent.callee)) return true;
    if (isUrlSetAttributeCall(parent, topNode)) return true;
  }

  return false;
};

// Flags `URL.createObjectURL(...)` whose produced URL escapes (assigned to
// an element `href`/`src` directly or via `setAttribute`, stored into a ref,
// returned, rendered inline in JSX, passed to a state setter, or a guarded
// value bound to a variable — declared or assigned)
// when the module never references `URL.revokeObjectURL`. The blob URL
// pins its Blob/File in memory until revoked, so an un-revoked URL leaks.
// Stays quiet when the module stores results into a cache-named
// module-scope Map/Set — a deliberate app-lifetime cache whose URLs are
// never "done".
export const noCreateObjectUrlWithoutRevoke = defineRule({
  id: "no-create-object-url-without-revoke",
  title: "createObjectURL without revokeObjectURL",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Call `URL.revokeObjectURL(url)` once the object URL is no longer needed (after the download, in a `useEffect` cleanup, or on unmount). An object URL keeps its Blob/File alive for the document lifetime until it is revoked.",
  create: (context: RuleContext) => {
    let moduleHasRevoke = false;
    let moduleHasDeliberateCache = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        moduleHasRevoke = moduleReferencesRevoke(node);
        moduleHasDeliberateCache = moduleKeepsResultsInModuleScopeCache(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (moduleHasRevoke || moduleHasDeliberateCache) return;
        if (!isCreateObjectUrlCall(node)) return;
        if (!escapeIsLeaky(node)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
