import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findDeferredExecutionBoundary } from "../../utils/find-deferred-execution-boundary.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasBindingWriteBetween } from "../../utils/has-binding-write-between.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// Static property name of a member access (`a.b` / `a["b"]`), or null for a
// dynamic computed access (`a[key]`).
const getStaticMemberPropertyName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "MemberExpression")) return null;
  return getStaticPropertyName(unwrapped);
};

const someNodeInSubtree = (root: EsTreeNode, predicate: (node: EsTreeNode) => boolean): boolean => {
  let didMatch = false;
  walkAst(root, (node) => {
    if (predicate(node)) {
      didMatch = true;
      return false;
    }
  });
  return didMatch;
};

const MESSAGE =
  "This passes an href/hash-derived string to a DOM selector API, which throws a `DOMException` on an invalid CSS selector instead of returning null. Wrap the call in try/catch or escape the value with `CSS.escape`.";

const SELECTOR_QUERY_METHOD_NAMES = new Set([
  "querySelector",
  "querySelectorAll",
  "matches",
  "closest",
]);
const ELEMENT_RECEIVER_METHOD_NAMES = new Set(["matches", "closest"]);
const HREF_ATTRIBUTE_NAMES = new Set(["href", "hash"]);
const HREF_HASH_FUNCTION_PATTERN = /href|hash/i;
const SHAPE_VALIDATION_METHOD_NAMES = new Set([
  "match",
  "test",
  "exec",
  "indexOf",
  "includes",
  "has",
  "some",
  "every",
]);
const REGEX_VALIDATION_METHOD_NAMES = new Set(["match", "test", "exec"]);
const SAFE_HASH_SELECTOR_PATTERNS = new Set([
  "^#[A-Za-z][\\w-]*$",
  "^#[a-zA-Z][\\w-]*$",
  "^#[a-z][a-z0-9-]*$",
  "^[A-Za-z][\\w-]*$",
  "^[a-zA-Z][\\w-]*$",
]);
const STRING_DERIVATION_METHOD_NAMES = new Set([
  "slice",
  "substring",
  "substr",
  "replace",
  "replaceAll",
  "concat",
  "trim",
  "trimStart",
  "trimEnd",
  "toLowerCase",
  "toUpperCase",
  "normalize",
]);
const PREDICATE_CALLEE_NAME_PATTERN = /^(?:is|has|can|check|validate?)|valid/i;
const NON_DOM_RECEIVER_NAME_PATTERN = /rout(?:e|er)|pattern|history|matcher/i;
const SAFE_HASH_SELECTOR_LITERAL_PATTERN = /^#[A-Za-z][\w-]*$/;

const isSafeHashSelectorLiteral = (node: EsTreeNode): boolean => {
  const literal = stripParenExpression(node);
  return (
    isNodeOfType(literal, "Literal") &&
    typeof literal.value === "string" &&
    SAFE_HASH_SELECTOR_LITERAL_PATTERN.test(literal.value)
  );
};
const DOM_ELEMENT_NAME_SEGMENTS = new Set([
  "el",
  "elem",
  "element",
  "node",
  "anchor",
  "target",
  "current",
  "ref",
  "dom",
  "body",
  "document",
  "container",
  "parent",
  "link",
  "button",
]);

const isHrefOrHashAttributeName = (value: unknown): boolean =>
  typeof value === "string" && HREF_ATTRIBUTE_NAMES.has(value);

// `el.getAttribute("href")` / `el.getAttribute("hash")`.
const isHrefGetAttributeCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (getStaticMemberPropertyName(node.callee) !== "getAttribute") return false;
  const firstArgument = node.arguments?.[0];
  return Boolean(
    firstArgument &&
    isNodeOfType(firstArgument, "Literal") &&
    isHrefOrHashAttributeName(firstArgument.value),
  );
};

// A member access whose property is `href`/`hash` (`el.href`, `location.hash`).
const isHrefHashMemberAccess = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const propertyName = getStaticMemberPropertyName(node);
  return Boolean(propertyName && HREF_ATTRIBUTE_NAMES.has(propertyName));
};

// A call to a helper named like `getHashFromHref` / `getHref` / `hashFor`.
const isHrefHashNamedCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return HREF_HASH_FUNCTION_PATTERN.test(callee.name);
  const propertyName = getStaticMemberPropertyName(callee);
  return Boolean(propertyName && HREF_HASH_FUNCTION_PATTERN.test(propertyName));
};

// `CSS.escape(...)` or the `css.escape` npm polyfill imported as an
// identifier (`cssEscape(...)`).
const isCssEscapeCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name.replaceAll(/[^a-z]/gi, "").toLowerCase() === "cssescape";
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "CSS" &&
    getStaticMemberPropertyName(callee) === "escape"
  );
};

const isRegexValidationCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const methodName = getStaticMemberPropertyName(node.callee);
  if (!methodName || !REGEX_VALIDATION_METHOD_NAMES.has(methodName)) return false;
  const receiver = stripParenExpression(node.callee.object as EsTreeNode);
  return Boolean(
    isNodeOfType(receiver, "Literal") &&
    "regex" in receiver &&
    receiver.regex &&
    SAFE_HASH_SELECTOR_PATTERNS.has(receiver.regex.pattern),
  );
};

const isImportSpecifierNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ImportSpecifier") ||
  isNodeOfType(node, "ImportDefaultSpecifier") ||
  isNodeOfType(node, "ImportNamespaceSpecifier");

// An href/hash-named helper whose in-file definition sanitizes with
// `CSS.escape` (the fix the rule recommends) or regex-validates its value
// (`/^#[A-Za-z][\w-]*$/.test(...)` returning null on mismatch) — its output
// shape is self-controlled. An IMPORTED helper of that name gets the same
// benefit of the doubt: its body is invisible, and a cross-file
// `hashToSelector` overwhelmingly exists to do exactly this sanitizing.
const isSanitizedSelectorHelperCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  if (!binding?.initializer) return false;
  if (isImportSpecifierNode(binding.initializer)) return true;
  const helper = stripParenExpression(binding.initializer);
  if (!isFunctionLike(helper)) return false;
  const returnedExpressions: EsTreeNode[] = [];
  if (!isNodeOfType(helper.body, "BlockStatement")) {
    returnedExpressions.push(helper.body as EsTreeNode);
  } else {
    walkAst(helper.body, (candidate) => {
      if (candidate !== helper && isFunctionLike(candidate)) return false;
      if (isNodeOfType(candidate, "ReturnStatement") && candidate.argument) {
        returnedExpressions.push(candidate.argument as EsTreeNode);
      }
    });
  }
  return (
    returnedExpressions.length > 0 &&
    returnedExpressions.every((returnedExpression) =>
      someNodeInSubtree(
        returnedExpression,
        (candidate) => isCssEscapeCall(candidate) || isRegexValidationCall(candidate),
      ),
    )
  );
};

// `href.slice(hashIndex)`, `location.hash.replace(...)` — a string-slicing
// method whose receiver is itself href/hash tainted (an href/hash-named
// identifier or a tainted expression) hands back a fragment of that value.
// Validation methods (`startsWith`, `match`) stay out: they return
// booleans/arrays, not selector strings.
const isStringDerivationCallOnHrefTaintedReceiver = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const methodName = getStaticMemberPropertyName(node.callee);
  if (!methodName || !STRING_DERIVATION_METHOD_NAMES.has(methodName)) return false;
  const receiver = stripParenExpression(node.callee.object);
  if (isNodeOfType(receiver, "Identifier")) return HREF_HASH_FUNCTION_PATTERN.test(receiver.name);
  return isHrefHashDerivedExpression(receiver);
};

const isHrefHashDerivedExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (isHrefGetAttributeCall(stripped) || isHrefHashMemberAccess(stripped)) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isHrefHashDerivedExpression(stripped.consequent) ||
      isHrefHashDerivedExpression(stripped.alternate)
    );
  }
  if (isStringDerivationCallOnHrefTaintedReceiver(stripped)) return true;
  return isHrefHashNamedCall(stripped) && !isSanitizedSelectorHelperCall(stripped);
};

const ITERATION_CALLBACK_METHOD_NAMES = new Set(["map", "forEach", "filter", "flatMap", "find"]);

// Every element is an object literal, and every `href` it declares is a
// string literal — the developer-authored nav-table shape.
const isLiteralHrefTable = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (!isNodeOfType(stripped, "ArrayExpression")) return false;
  const elements = stripped.elements ?? [];
  if (elements.length === 0) return false;
  return elements.every((element) => {
    if (!element) return false;
    const strippedElement = stripParenExpression(element as EsTreeNode);
    if (!isNodeOfType(strippedElement, "ObjectExpression")) return false;
    return strippedElement.properties.every((property) => {
      if (!isNodeOfType(property, "Property")) return false;
      let propertyName: string | null = null;
      if (!property.computed && isNodeOfType(property.key, "Identifier")) {
        propertyName = property.key.name;
      } else if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
        propertyName = property.key.value;
      }
      if (propertyName === null) return false;
      if (propertyName !== "href") return true;
      const value = stripParenExpression(property.value as EsTreeNode);
      return isSafeHashSelectorLiteral(value);
    });
  });
};

// `navItems.map((item) => document.querySelector(item.href))` where
// `navItems` is a same-file array of object literals with literal `href`s
// — every selector the query can receive is developer-authored, so the
// DOMException the rule warns about cannot occur.
const selectorComesFromLiteralHrefTable = (
  selectorArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const stripped = stripParenExpression(selectorArgument);
  let member: EsTreeNode = stripped;
  if (isNodeOfType(member, "ChainExpression")) member = member.expression as EsTreeNode;
  if (!isNodeOfType(member, "MemberExpression")) {
    if (!isNodeOfType(stripped, "Identifier")) return false;
    const binding = findVariableInitializer(stripped, stripped.name);
    if (!binding?.initializer) return false;
    member = stripParenExpression(binding.initializer);
    if (isNodeOfType(member, "ChainExpression")) member = member.expression as EsTreeNode;
    if (!isNodeOfType(member, "MemberExpression")) return false;
  }
  const itemRoot = stripParenExpression(member.object as EsTreeNode);
  if (!isNodeOfType(itemRoot, "Identifier")) return false;
  const itemBinding = findVariableInitializer(itemRoot, itemRoot.name);
  if (!itemBinding || itemBinding.initializer) return false;
  const callbackFunction = itemBinding.scopeOwner;
  const callbackParams = (callbackFunction as { params?: EsTreeNode[] }).params;
  if (!Array.isArray(callbackParams) || callbackParams[0] !== itemBinding.bindingIdentifier) {
    return false;
  }
  const iterationCall = callbackFunction.parent;
  if (
    !iterationCall ||
    !isNodeOfType(iterationCall, "CallExpression") ||
    !iterationCall.arguments?.includes(callbackFunction as never) ||
    !isNodeOfType(iterationCall.callee, "MemberExpression")
  ) {
    return false;
  }
  const methodName = getStaticMemberPropertyName(iterationCall.callee);
  if (!methodName || !ITERATION_CALLBACK_METHOD_NAMES.has(methodName)) return false;
  const tableReceiver = stripParenExpression(iterationCall.callee.object as EsTreeNode);
  if (isLiteralHrefTable(tableReceiver)) return true;
  if (!isNodeOfType(tableReceiver, "Identifier")) return false;
  const tableBinding = findVariableInitializer(tableReceiver, tableReceiver.name);
  if (!tableBinding?.initializer || !isLiteralHrefTable(tableBinding.initializer)) return false;
  return !hasBindingWriteBetween(
    tableReceiver,
    tableBinding.bindingIdentifier,
    iterationCall,
    scopes,
  );
};

// The selector argument taints to an href/hash value: either directly, or
// through a same-file binding whose initializer is href/hash-derived.
const selectorArgumentTaintsToHref = (argument: EsTreeNode): boolean => {
  if (isHrefHashDerivedExpression(argument)) return true;
  const stripped = stripParenExpression(argument);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  return Boolean(binding?.initializer && isHrefHashDerivedExpression(binding.initializer));
};

const isStringLiteralSelector = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return typeof stripped.value === "string";
  return isNodeOfType(stripped, "TemplateLiteral") && stripped.expressions.length === 0;
};

const hasDomElementNameSegment = (name: string): boolean =>
  name
    .split(/[^A-Za-z]+/)
    .flatMap((word) => word.split(/(?=[A-Z])/))
    .some((segment) => DOM_ELEMENT_NAME_SEGMENTS.has(segment.toLowerCase()));

// `matches`/`closest` also exist on route matchers, URLPattern-style objects,
// and hash routers, none of which throw on an invalid CSS selector — only
// fire when the receiver's name reads as a DOM element, and a router-ish
// word anywhere in the name (`parentRoute`, `urlPattern`) vetoes the match.
const isLikelyDomElementReceiver = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  const receiverName = isNodeOfType(stripped, "Identifier")
    ? stripped.name
    : getStaticMemberPropertyName(stripped);
  if (!receiverName) return false;
  if (NON_DOM_RECEIVER_NAME_PATTERN.test(receiverName)) return false;
  return hasDomElementNameSegment(receiverName);
};

// Matches the tainted value itself (by name or href/hash derivation) and,
// one hop out, bindings derived FROM it (`const anchorId = hash.slice(1)`)
// — a shape check on the derivation pins the source just as soundly.
const makeTaintedReferenceMatcher = (
  selectorArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): ((candidate: EsTreeNode) => boolean) => {
  const stripped = stripParenExpression(selectorArgument);
  const taintedIdentifier = isNodeOfType(stripped, "Identifier") ? stripped : null;
  const taintedSymbol = taintedIdentifier ? scopes.symbolFor(taintedIdentifier) : null;
  const referencesTaintDirectly = (candidate: EsTreeNode): boolean => {
    if (taintedIdentifier && isNodeOfType(candidate, "Identifier")) {
      const candidateSymbol = scopes.symbolFor(candidate);
      if (taintedSymbol) return candidateSymbol === taintedSymbol;
      if (candidateSymbol === null && candidate.name === taintedIdentifier.name) return true;
    }
    return isHrefHashDerivedExpression(candidate);
  };
  return (candidate: EsTreeNode): boolean => {
    if (referencesTaintDirectly(candidate)) return true;
    if (!isNodeOfType(candidate, "Identifier") || candidate === taintedIdentifier) return false;
    const binding = findVariableInitializer(candidate, candidate.name);
    return Boolean(
      binding?.initializer && someNodeInSubtree(binding.initializer, referencesTaintDirectly),
    );
  };
};

// `hash.startsWith('#')`, `HASH_PATTERN.test(hash)`,
// `knownIds.indexOf(location.hash) !== -1`, `SECTION_ANCHORS.has(hash)` —
// the tainted value appears as the receiver or an argument of a
// string/regex/membership check, not a bare truthiness read.
const isShapeValidatingCall = (
  node: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const taintedInArguments = (node.arguments ?? []).some((argument) =>
    someNodeInSubtree(argument, referencesTaintedValue),
  );
  // A bare predicate call in guard position (`if (!isValidAnchor(hash))
  // return;`) — the name promises validation and the branch enforces it.
  if (isNodeOfType(node.callee, "Identifier")) {
    if (!taintedInArguments || !PREDICATE_CALLEE_NAME_PATTERN.test(node.callee.name)) return false;
    const binding = findVariableInitializer(node.callee, node.callee.name);
    return Boolean(
      binding?.initializer &&
      someNodeInSubtree(binding.initializer, (candidate) => isRegexValidationCall(candidate)),
    );
  }
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const methodName = getStaticMemberPropertyName(node.callee);
  if (!methodName || !SHAPE_VALIDATION_METHOD_NAMES.has(methodName)) return false;
  if (REGEX_VALIDATION_METHOD_NAMES.has(methodName)) {
    return (
      isRegexValidationCall(node) &&
      (taintedInArguments || someNodeInSubtree(node.callee.object, referencesTaintedValue))
    );
  }
  return taintedInArguments && !someNodeInSubtree(node.callee.object, referencesTaintedValue);
};

// The root `expect(...)` call of an assertion chain (`expect(hash).toBe(…)`),
// or null when the chain roots elsewhere or carries no chained assertion.
const getExpectChainRootCall = (node: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  let root: EsTreeNodeOfType<"CallExpression"> = node;
  while (true) {
    const callee: EsTreeNode = stripParenExpression(root.callee as EsTreeNode);
    if (isNodeOfType(callee, "MemberExpression")) {
      const nextCall = stripParenExpression(callee.object as EsTreeNode);
      if (!isNodeOfType(nextCall, "CallExpression")) return null;
      root = nextCall;
      continue;
    }
    if (!isNodeOfType(callee, "Identifier") || callee.name !== "expect" || root === node) {
      return null;
    }
    return root;
  }
};

// `expect(hash).toBe('#faq')`, `expect(href).toMatch(/^#[a-z-]+$/)` — a
// failed assertion throws, so a preceding assertion mentioning the tainted
// value dominates the query the same way an early-exit guard does.
const isTaintPinningAssertion = (
  node: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  const rootCall = getExpectChainRootCall(node);
  if (!rootCall) return false;
  if (
    !(rootCall.arguments ?? []).some((argument) =>
      someNodeInSubtree(argument, referencesTaintedValue),
    )
  ) {
    return false;
  }
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }
  const matcherName = getStaticMemberPropertyName(node.callee);
  const expectedValue = node.arguments[0];
  if (!matcherName || !expectedValue || isNodeOfType(expectedValue, "SpreadElement")) return false;
  if (matcherName === "toBe" || matcherName === "toEqual" || matcherName === "toStrictEqual") {
    return isSafeHashSelectorLiteral(expectedValue as EsTreeNode);
  }
  if (matcherName !== "toMatch") return false;
  const expectedPattern = stripParenExpression(expectedValue as EsTreeNode);
  return Boolean(
    isNodeOfType(expectedPattern, "Literal") &&
    "regex" in expectedPattern &&
    expectedPattern.regex &&
    SAFE_HASH_SELECTOR_PATTERNS.has(expectedPattern.regex.pattern),
  );
};

const hasTaintedBindingWriteBetween = (
  selectorArgument: EsTreeNode,
  validationNode: EsTreeNode,
  callNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(selectorArgument);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  return hasBindingWriteBetween(identifier, validationNode, callNode, scopes);
};

// `hash === '#pricing'`, `hash in sectionOffsets` — the guard pins the
// tainted value to specific literal keys/values, the strongest validation.
const isTaintPinningComparison = (
  node: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  const left = node.left as EsTreeNode;
  const right = node.right as EsTreeNode;
  if (node.operator === "in") return someNodeInSubtree(left, referencesTaintedValue);
  if (node.operator !== "===" && node.operator !== "==") return false;
  const pins = (valueSide: EsTreeNode, literalSide: EsTreeNode): boolean => {
    return (
      someNodeInSubtree(valueSide, referencesTaintedValue) && isSafeHashSelectorLiteral(literalSide)
    );
  };
  return pins(left, right) || pins(right, left);
};

const isShapeValidatingExpression = (
  node: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean =>
  isShapeValidatingCall(node, referencesTaintedValue) ||
  isTaintPinningComparison(node, referencesTaintedValue) ||
  isTaintPinningAssertion(node, referencesTaintedValue);

const isNegativeOneLiteral = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  return (
    isNodeOfType(inner, "UnaryExpression") &&
    inner.operator === "-" &&
    isNodeOfType(inner.argument, "Literal") &&
    inner.argument.value === 1
  );
};

const containmentComparisonGuaranteesValidSelector = (
  node: EsTreeNode,
  branchRunsWhenTruthy: boolean,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "BinaryExpression")) return false;
  const left = inner.left as EsTreeNode;
  const right = inner.right as EsTreeNode;
  let validationCall: EsTreeNode | null = null;
  if (isNegativeOneLiteral(right)) validationCall = left;
  else if (isNegativeOneLiteral(left)) validationCall = right;
  if (!validationCall || !isShapeValidatingCall(validationCall, referencesTaintedValue)) {
    return false;
  }
  if (inner.operator === "!==" || inner.operator === "!=") return branchRunsWhenTruthy;
  if (inner.operator === "===" || inner.operator === "==") return !branchRunsWhenTruthy;
  return false;
};

// Every conditional test that dominates the query call: enclosing
// if/ternary/logical-&& tests, preceding early-exit guards (`if (…)
// return;`), and preceding `expect(...)` assertion statements (a failed
// assertion throws, dominating everything after it) in the statement lists
// between the call and the root.
const expressionGuaranteesValidSelector = (
  test: EsTreeNode,
  branchRunsWhenTruthy: boolean,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  const inner = stripParenExpression(test);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    return expressionGuaranteesValidSelector(
      inner.argument as EsTreeNode,
      !branchRunsWhenTruthy,
      referencesTaintedValue,
    );
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    const leftGuarantees = expressionGuaranteesValidSelector(
      inner.left as EsTreeNode,
      branchRunsWhenTruthy,
      referencesTaintedValue,
    );
    const rightGuarantees = expressionGuaranteesValidSelector(
      inner.right as EsTreeNode,
      branchRunsWhenTruthy,
      referencesTaintedValue,
    );
    if (inner.operator === "&&") {
      return branchRunsWhenTruthy
        ? leftGuarantees || rightGuarantees
        : leftGuarantees && rightGuarantees;
    }
    if (inner.operator === "||") {
      return branchRunsWhenTruthy
        ? leftGuarantees && rightGuarantees
        : leftGuarantees || rightGuarantees;
    }
  }
  if (
    containmentComparisonGuaranteesValidSelector(
      inner,
      branchRunsWhenTruthy,
      referencesTaintedValue,
    )
  ) {
    return true;
  }
  return branchRunsWhenTruthy && isShapeValidatingExpression(inner, referencesTaintedValue);
};

// A non-default `case` pins the tainted discriminant to its literal:
// `switch (location.hash) { case '#pricing': … }` cannot reach the query
// with an arbitrary hash.
const isPinnedByEnclosingSwitchCase = (
  callNode: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "SwitchCase") &&
      ancestor.test !== null &&
      ancestor.parent &&
      isNodeOfType(ancestor.parent, "SwitchStatement") &&
      someNodeInSubtree(ancestor.parent.discriminant, referencesTaintedValue) &&
      isSafeHashSelectorLiteral(ancestor.test)
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A dominating guard already shape-validated the tainted value (regex test,
// prefix check, containment/equality/membership check, assertion) — the
// selector's shape is self-controlled, so the DOMException the rule warns
// about cannot occur in practice. Bare truthiness guards (`if (href)`) do
// NOT count.
const isShapeValidatedByDominatingGuard = (
  callNode: EsTreeNode,
  selectorArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const referencesTaintedValue = makeTaintedReferenceMatcher(selectorArgument, scopes);
  if (isPinnedByEnclosingSwitchCase(callNode, referencesTaintedValue)) return true;
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (
      (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
      ancestor.test !== child &&
      expressionGuaranteesValidSelector(
        ancestor.test,
        ancestor.consequent === child,
        referencesTaintedValue,
      ) &&
      !hasTaintedBindingWriteBetween(selectorArgument, ancestor.test, callNode, scopes)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.right === child &&
      expressionGuaranteesValidSelector(
        ancestor.left as EsTreeNode,
        ancestor.operator === "&&",
        referencesTaintedValue,
      ) &&
      !hasTaintedBindingWriteBetween(
        selectorArgument,
        ancestor.left as EsTreeNode,
        callNode,
        scopes,
      )
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      for (const statement of ancestor.body) {
        if (statement === child) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          isEarlyExitStatement(statement.consequent) &&
          expressionGuaranteesValidSelector(statement.test, false, referencesTaintedValue) &&
          !hasTaintedBindingWriteBetween(selectorArgument, statement.test, callNode, scopes)
        ) {
          return true;
        }
        if (
          isNodeOfType(statement, "ExpressionStatement") &&
          isTaintPinningAssertion(statement.expression, referencesTaintedValue) &&
          !hasTaintedBindingWriteBetween(selectorArgument, statement.expression, callNode, scopes)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// The query sits in a callback of a promise chain that carries a rejection
// handler (`.then(() => { … }).catch(() => {})` or a two-argument `.then`)
// — a throw inside the callback rejects the chain and is captured, exactly
// like the try/catch the rule recommends.
const isInsideCatchGuardedPromiseCallback = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const enclosingCall = ancestor.parent;
      if (
        enclosingCall &&
        isNodeOfType(enclosingCall, "CallExpression") &&
        enclosingCall.arguments?.some((argument) => argument === ancestor) &&
        getStaticMemberPropertyName(enclosingCall.callee) === "then"
      ) {
        let chainLink: EsTreeNode = enclosingCall;
        while (
          chainLink.parent &&
          isNodeOfType(chainLink.parent, "MemberExpression") &&
          chainLink.parent.object === chainLink &&
          chainLink.parent.parent &&
          isNodeOfType(chainLink.parent.parent, "CallExpression")
        ) {
          const linkName = getStaticMemberPropertyName(chainLink.parent);
          const linkCall: EsTreeNode = chainLink.parent.parent;
          if (linkName === "catch") return true;
          if (linkName === "then" && (linkCall.arguments?.length ?? 0) >= 2) return true;
          chainLink = linkCall;
        }
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// The query lives in a named same-file helper whose every call site is
// inside a try block — the rule's recommended try/catch applied one frame
// up. Any non-call reference (passed as a callback) disqualifies.
const isInHelperOnlyInvokedInsideTry = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  helperTryGuardCache: WeakMap<EsTreeNode, boolean>,
): boolean => {
  let helperFunction: EsTreeNode | null = null;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      helperFunction = ancestor;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  if (!helperFunction) return false;
  if ("async" in helperFunction && helperFunction.async === true) return false;
  const cachedResult = helperTryGuardCache.get(helperFunction);
  if (cachedResult !== undefined) return cachedResult;
  let helperDefinitionIdentifier: EsTreeNode | null = null;
  if (
    isNodeOfType(helperFunction, "FunctionDeclaration") &&
    helperFunction.id &&
    isNodeOfType(helperFunction.id, "Identifier")
  ) {
    helperDefinitionIdentifier = helperFunction.id;
  } else if (
    helperFunction.parent &&
    isNodeOfType(helperFunction.parent, "VariableDeclarator") &&
    isNodeOfType(helperFunction.parent.id, "Identifier")
  ) {
    helperDefinitionIdentifier = helperFunction.parent.id;
  }
  if (!helperDefinitionIdentifier || !isNodeOfType(helperDefinitionIdentifier, "Identifier")) {
    helperTryGuardCache.set(helperFunction, false);
    return false;
  }
  const helperName = helperDefinitionIdentifier.name;
  const helperSymbol = isNodeOfType(helperFunction, "FunctionDeclaration")
    ? scopes.scopeFor(helperDefinitionIdentifier).symbolsByName.get(helperName)
    : scopes.symbolFor(helperDefinitionIdentifier);
  if (!helperSymbol) {
    helperTryGuardCache.set(helperFunction, false);
    return false;
  }
  let callSiteCount = 0;
  let sawUnguardedOrNonCallReference = false;
  for (const reference of helperSymbol.references) {
    const candidate = reference.identifier;
    const isDirectCallSite =
      candidate.parent &&
      isNodeOfType(candidate.parent, "CallExpression") &&
      candidate.parent.callee === candidate;
    if (
      !isDirectCallSite ||
      !isInsideTryStatement(candidate.parent as EsTreeNode, {
        region: "block",
        boundary: findDeferredExecutionBoundary(candidate.parent as EsTreeNode),
      })
    ) {
      sawUnguardedOrNonCallReference = true;
      break;
    }
    callSiteCount += 1;
  }
  const isGuarded = !sawUnguardedOrNonCallReference && callSiteCount > 0;
  helperTryGuardCache.set(helperFunction, isGuarded);
  return isGuarded;
};

// Flags `document.querySelector(x)` / `querySelectorAll` / `Element.matches` /
// `closest` when the selector argument taints to an anchor href/hash value and
// the call is not inside try/catch. The query throws a `DOMException` on an
// invalid selector, so an href fragment like `#section 1` crashes the handler.
//
// Taint sources: `getAttribute('href'|'hash')`, `.href`/`.hash` member reads,
// href/hash-named helper calls, string-derivation methods on href/hash-named
// receivers (`href.slice(hashIndex)`), and ternaries with a tainted branch
// (`hashIndex !== -1 ? href.slice(hashIndex) : ''`).
//
// v1 scope: only the high-confidence href/hash sink fires. String literals,
// CSS-module templates, `CSS.escape` outputs (including in-file helpers that
// wrap it), SCREAMING_SNAKE selector constants, opaque `props.*Selector`
// config values, non-DOM `matches()`/`closest()` receivers (route matchers),
// and values shape-validated by a dominating guard (regex test, prefix or
// containment check) are intentionally quiet.
export const noNonLiteralSelectorQueryWithoutTryCatch = defineRule({
  id: "no-non-literal-selector-query-without-try-catch",
  title: "Unguarded querySelector with href-derived selector",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`querySelector`/`querySelectorAll`/`matches`/`closest` throw a `DOMException` on an invalid CSS selector, and href/hash fragments are frequently invalid. Wrap the call in try/catch or normalize the value with `CSS.escape`.",
  create: (context: RuleContext) => {
    const helperTryGuardCache = new WeakMap<EsTreeNode, boolean>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee as EsTreeNode);
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const methodName = getStaticMemberPropertyName(callee);
        if (!methodName || !SELECTOR_QUERY_METHOD_NAMES.has(methodName)) return;
        if (
          ELEMENT_RECEIVER_METHOD_NAMES.has(methodName) &&
          !isLikelyDomElementReceiver(callee.object)
        ) {
          return;
        }
        const selectorArgument = node.arguments?.[0];
        if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return;
        if (isStringLiteralSelector(selectorArgument)) return;
        if (!selectorArgumentTaintsToHref(selectorArgument)) return;
        if (selectorComesFromLiteralHrefTable(selectorArgument, context.scopes)) return;
        if (isShapeValidatedByDominatingGuard(node, selectorArgument, context.scopes)) return;
        if (
          isInsideTryStatement(node as EsTreeNode, {
            region: "block",
            boundary: findDeferredExecutionBoundary(node),
          })
        ) {
          return;
        }
        if (isInsideCatchGuardedPromiseCallback(node)) return;
        if (isInHelperOnlyInvokedInsideTry(node, context.scopes, helperTryGuardCache)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
