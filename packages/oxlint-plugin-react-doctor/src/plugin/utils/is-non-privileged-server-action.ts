import {
  CACHE_REVALIDATION_FUNCTION_NAMES,
  NEXTJS_NAVIGATION_FUNCTIONS,
} from "../constants/nextjs.js";
import { collectLocallyScopedCookieBindings } from "./collect-locally-scoped-cookie-bindings.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportSourceForName } from "./find-import-source-for-name.js";
import { isCookiesOrAwaitedCookiesCall } from "./is-cookies-or-awaited-cookies-call.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { tokenizeIdentifierWords } from "./tokenize-identifier-words.js";
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

const LOCALE_PREFERENCE_VERB_TOKENS: ReadonlySet<string> = new Set(["set", "update"]);

const LOCALE_PREFERENCE_NOUN_TOKENS: ReadonlySet<string> = new Set(["language", "locale"]);

const COOKIE_DELETION_METHOD_NAME = "delete";

// Matched only as a BARE identifier callee whose binding is IMPORTED. A member
// call (`obj.redirect()`, `db.revalidateTag()`) shares the name but not the
// import, and a module-local `const revalidatePath = …` doing privileged work
// defines the name locally rather than importing it — both must not satisfy the
// exemption. Requiring an import (rather than a specific `next/*` source) keeps
// the local-shadow out while still exempting the common re-export barrel
// (`import { revalidatePath } from "@/lib/cache"`), which the real Next.js
// symbol is routinely funneled through and which we cannot resolve in-file.
const isCacheOrNavigationCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier")) {
    return false;
  }
  return (
    NON_DATA_EFFECT_FUNCTION_NAMES.has(node.callee.name) &&
    getImportSourceForName(node, node.callee.name) !== null
  );
};

const isCallerScopedLocalePreferenceCall = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.arguments?.length !== 1
  ) {
    return false;
  }
  const nameTokens = tokenizeIdentifierWords(node.callee.name);
  if (!nameTokens.some((token) => LOCALE_PREFERENCE_VERB_TOKENS.has(token))) return false;
  if (!nameTokens.some((token) => LOCALE_PREFERENCE_NOUN_TOKENS.has(token))) return false;

  const importSource = getImportSourceForName(node, node.callee.name)?.toLowerCase();
  return Boolean(importSource?.includes("i18n") || importSource?.includes("locale"));
};

const isCallerScopedCookieCall = (
  node: EsTreeNode,
  cookieBindingNames: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier")) {
    return (
      node.callee.name === "cookies" &&
      getImportSourceForName(node, node.callee.name) === "next/headers"
    );
  }
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== COOKIE_DELETION_METHOD_NAME
  ) {
    return false;
  }
  const receiver = stripParenExpression(node.callee.object);
  if (isNodeOfType(receiver, "Identifier")) return cookieBindingNames.has(receiver.name);
  return (
    isCookiesOrAwaitedCookiesCall(receiver) &&
    getImportSourceForName(receiver, "cookies") === "next/headers"
  );
};

const isKnownNonDataEffectCall = (
  node: EsTreeNode,
  cookieBindingNames: ReadonlySet<string>,
): boolean =>
  isCacheOrNavigationCall(node) ||
  isCallerScopedLocalePreferenceCall(node) ||
  isCallerScopedCookieCall(node, cookieBindingNames);

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
// caller. Only a purely literal value (or a known non-data-effect call, whose
// result is void) is safe; anything referencing a binding could carry protected data.
const isDataExposingValue = (
  node: EsTreeNode | null | undefined,
  cookieBindingNames: ReadonlySet<string>,
): boolean => {
  const value = unwrapExpression(node);
  if (!value) return false;
  if (isKnownNonDataEffectCall(value, cookieBindingNames)) return false;
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
const isDataExposingReturnOrThrow = (
  node: EsTreeNode,
  cookieBindingNames: ReadonlySet<string>,
): boolean => isDataExposingValue(getReturnedOrThrownArgument(node), cookieBindingNames);

// Any node that can reach state beyond the action's own locals: an unknown call
// (DB query, `fetch`, cookie mutation, an imported
// helper), a tagged template (raw-SQL clients like `sql\`DELETE …\``), a
// constructor, an assignment, a `delete`, or a `return`/`throw` that exposes
// data.
const isPrivilegedEffect = (node: EsTreeNode, cookieBindingNames: ReadonlySet<string>): boolean =>
  isNodeOfType(node, "CallExpression") ||
  isNodeOfType(node, "TaggedTemplateExpression") ||
  isNodeOfType(node, "NewExpression") ||
  isNodeOfType(node, "AssignmentExpression") ||
  isNodeOfType(node, "UpdateExpression") ||
  (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") ||
  isDataExposingReturnOrThrow(node, cookieBindingNames);

// A server action is "non-privileged" when nothing it does can read or mutate
// protected data: its body only changes a caller-scoped locale, busts the cache,
// and/or navigates, and contains no other effect. Such an action is safe to call unauthenticated, so the
// missing-auth-check rule must not flag it.
//
// The check is conservative: the body must contain at least one known non-data
// effect call AND no privileged effect. Anything else — a DB write,
// a `fetch`, an imported helper, a raw-SQL tagged template, a constructor, or
// returning a value to the caller — disqualifies the exemption, so a genuinely
// sensitive action is never silently allowed through.
export const isNonPrivilegedServerAction = (functionNode: FunctionLikeNode): boolean => {
  const functionBody = functionNode.body;
  if (!functionBody) return false;
  const cookieBindingNames =
    getImportSourceForName(functionBody, "cookies") === "next/headers"
      ? collectLocallyScopedCookieBindings(functionBody)
      : new Set<string>();

  // A concise-body arrow (`async () => expr`) implicitly returns its body, with
  // no `ReturnStatement` for the walk to catch. Treat that implicit return as a
  // data exposure check; the walk below still flags any privileged effect in
  // the expression itself (e.g. an earlier operand of a comma sequence).
  if (
    !isNodeOfType(functionBody, "BlockStatement") &&
    isDataExposingValue(functionBody, cookieBindingNames)
  ) {
    return false;
  }

  let hasNonDataEffectCall = false;
  let hasPrivilegedEffect = false;

  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasPrivilegedEffect) return false;
    // Prune nested function bodies: a call inside a closure the action
    // never invokes shouldn't count for or against the exemption.
    if (child !== functionBody && isFunctionLike(child)) return false;

    // Keep descending after a known non-data-effect call so a privileged effect
    // hidden in its arguments (`revalidateTag(db.get())`) is still caught.
    if (isKnownNonDataEffectCall(child, cookieBindingNames)) {
      hasNonDataEffectCall = true;
      return;
    }
    if (isPrivilegedEffect(child, cookieBindingNames)) {
      hasPrivilegedEffect = true;
      return false;
    }
  });

  return hasNonDataEffectCall && !hasPrivilegedEffect;
};
