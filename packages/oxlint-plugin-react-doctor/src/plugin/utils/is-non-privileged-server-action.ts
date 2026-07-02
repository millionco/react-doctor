import {
  CACHE_REVALIDATION_FUNCTION_NAMES,
  NEXTJS_NAVIGATION_FUNCTIONS,
} from "../constants/nextjs.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportSourceForName } from "./find-import-source-for-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

// Calls that change neither protected data nor server state: Next.js cache
// invalidation (`revalidateTag`/`revalidatePath`/…) only busts the data
// cache, and navigation (`redirect`/`notFound`/…) only steers the response.
// An unauthenticated caller gains nothing by triggering either.
const NON_DATA_EFFECT_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  ...CACHE_REVALIDATION_FUNCTION_NAMES,
  ...NEXTJS_NAVIGATION_FUNCTIONS,
]);

// Matched only as a BARE identifier callee whose binding is IMPORTED. A member
// call (`obj.redirect()`, `db.revalidateTag()`) shares the name but not the
// import, and a module-local `const revalidatePath = …` doing privileged work
// defines the name locally rather than importing it — both must not satisfy the
// exemption. Requiring an import (rather than a specific `next/*` source) keeps
// the local-shadow out while still exempting the common re-export barrel
// (`import { revalidatePath } from "@/lib/cache"`), which the real Next.js
// symbol is routinely funneled through and which we cannot resolve in-file.
const isCacheOrNavigationCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  NON_DATA_EFFECT_FUNCTION_NAMES.has(node.callee.name) &&
  getImportSourceForName(node, node.callee.name) !== null;

// Reduce an expression to the value it actually yields: strip TS / optional-
// chain wrappers, and collapse a comma sequence to its last operand (the value
// a `(revalidateTag(x), secret)` body returns).
const unwrapExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (
      isNodeOfType(current, "TSAsExpression") ||
      isNodeOfType(current, "TSNonNullExpression") ||
      isNodeOfType(current, "TSSatisfiesExpression") ||
      isNodeOfType(current, "ChainExpression")
    ) {
      current = current.expression;
      continue;
    }
    if (isNodeOfType(current, "SequenceExpression")) {
      current = current.expressions?.[current.expressions.length - 1];
      continue;
    }
    return current;
  }
  return null;
};

// A value-yielding expression hands data back to the (possibly unauthenticated)
// caller. Only a purely literal value (or a cache/navigation call, whose result
// is void) is safe; anything referencing a binding could carry protected data.
const isDataExposingValue = (node: EsTreeNode | null | undefined): boolean => {
  const value = unwrapExpression(node);
  if (!value) return false;
  if (isCacheOrNavigationCall(value)) return false;
  return !isLiteralOnlyExpression(value);
};

// An expression built purely from literals — `true`, `"ok"`, `{ revalidated:
// true }`, `[1, 2]`, a template with only literal interpolations. It carries
// no reference to a binding, so returning it leaks nothing.
const isLiteralOnlyExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal")) return true;
  // `return undefined` parses as an Identifier but exposes nothing — same as
  // the bare `return;` (which has no argument at all). `void 0` already
  // passes via the UnaryExpression branch.
  if (isNodeOfType(node, "Identifier")) return node.name === "undefined";
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.expressions ?? []).every(isLiteralOnlyExpression);
  }
  if (isNodeOfType(node, "UnaryExpression")) return isLiteralOnlyExpression(node.argument);
  if (isNodeOfType(node, "ArrayExpression")) {
    return (node.elements ?? []).every(
      (element) =>
        element === null ||
        (!isNodeOfType(element, "SpreadElement") && isLiteralOnlyExpression(element)),
    );
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    return (node.properties ?? []).every(
      (property) =>
        isNodeOfType(property, "Property") &&
        (!property.computed || isLiteralOnlyExpression(property.key)) &&
        isLiteralOnlyExpression(property.value),
    );
  }
  return false;
};

const getReturnedOrThrownArgument = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument ?? null;
  if (isNodeOfType(node, "ThrowStatement")) return node.argument ?? null;
  return null;
};

// `return <value>` / `throw <value>` hands a value back to the (possibly
// unauthenticated) caller — i.e. potential data exposure, the read half of the
// threat (a thrown binding reaches the client via the error path). A returned
// identifier, member access, await, call, conditional, or a non-literal nested
// inside an object/array could carry protected data, so it disqualifies the
// exemption.
const isDataExposingReturnOrThrow = (node: EsTreeNode): boolean =>
  isDataExposingValue(getReturnedOrThrownArgument(node));

// Any node that can reach state beyond the action's own locals: a non-cache/
// non-navigation call (DB query, `fetch`, cookie mutation, an imported
// helper), a tagged template (raw-SQL clients like `sql\`DELETE …\``), a
// constructor, an assignment, a `delete`, or a `return`/`throw` that exposes
// data.
const isPrivilegedEffect = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") ||
  isNodeOfType(node, "TaggedTemplateExpression") ||
  isNodeOfType(node, "NewExpression") ||
  isNodeOfType(node, "AssignmentExpression") ||
  isNodeOfType(node, "UpdateExpression") ||
  (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") ||
  isDataExposingReturnOrThrow(node);

// A server action is "non-privileged" when nothing it does can read or mutate
// protected data: its body busts the cache and/or navigates, and contains no
// other effect. Such an action is safe to call unauthenticated, so the
// missing-auth-check rule must not flag it.
//
// The check is conservative: the body must contain at least one cache- or
// navigation call AND no other privileged effect. Anything else — a DB write,
// a `fetch`, an imported helper, a raw-SQL tagged template, a constructor, or
// returning a value to the caller — disqualifies the exemption, so a genuinely
// sensitive action is never silently allowed through.
export const isNonPrivilegedServerAction = (functionNode: FunctionLikeNode): boolean => {
  const functionBody = functionNode.body;
  if (!functionBody) return false;

  // A concise-body arrow (`async () => expr`) implicitly returns its body, with
  // no `ReturnStatement` for the walk to catch. Treat that implicit return as a
  // data exposure check; the walk below still flags any privileged effect in
  // the expression itself (e.g. an earlier operand of a comma sequence).
  if (!isNodeOfType(functionBody, "BlockStatement") && isDataExposingValue(functionBody)) {
    return false;
  }

  let hasNonDataEffectCall = false;
  let hasPrivilegedEffect = false;

  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasPrivilegedEffect) return false;
    // Prune nested function bodies: a call inside a closure the action
    // never invokes shouldn't count for or against the exemption.
    if (child !== functionBody && isFunctionLike(child)) return false;

    // Keep descending after a cache/navigation call so a privileged effect
    // hidden in its arguments (`revalidateTag(db.get())`) is still caught.
    if (isCacheOrNavigationCall(child)) {
      hasNonDataEffectCall = true;
      return;
    }
    if (isPrivilegedEffect(child)) {
      hasPrivilegedEffect = true;
      return false;
    }
  });

  return hasNonDataEffectCall && !hasPrivilegedEffect;
};
