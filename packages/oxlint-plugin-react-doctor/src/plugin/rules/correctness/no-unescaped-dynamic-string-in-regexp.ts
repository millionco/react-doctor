import { defineRule } from "../../utils/define-rule.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasBindingWriteBetween } from "../../utils/has-binding-write-between.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// Unit tests and Playwright/Cypress e2e page objects build regexes from
// developer-typed constants (test queries, test-id segments), never from
// runtime user input, so the rule's threat model does not apply. The
// `test-noise` tag covers most testlike files; this raw-path check
// additionally catches `tests/e2e/…` trees nested under a package source
// root, which the tag's source-root scoping treats as production.
const TEST_CONTEXT_FILE_PATTERN =
  /(\.test\.|\.spec\.|__tests__|(^|\/)(test|tests|e2e|cypress|playwright)\/)/;

// Identifier names that resolve the RegExp source to a user/config search,
// filter, highlight, or query term (the values that carry unescaped regex
// metacharacters). Kept deliberately narrow so controlled/constant sources
// stay quiet. `term(?!in)` keeps `searchTerm` while excluding
// `terminalSequence` / `terminate`-shaped names.
const SEARCH_TERM_NAME_PATTERN = /search|query|highlight|filter|term(?!in)|keyword/i;

// An escape helper applied to the value makes the pattern safe. Also treat
// `.replace(...)` / `.replaceAll(...)` as author-driven sanitization.
const ESCAPE_HELPER_NAME_PATTERN = /escape.*reg|safe.*reg/i;

// A binding named like `escapedSearchString` is an explicit author claim
// that the value was sanitized before construction.
const SANITIZED_NAME_PATTERN = /escap|sanitiz/i;

// How many identifier-to-initializer hops to follow when checking whether
// a binding was escaped on a prior line (`const escaped = escapeRegExp(q);
// const pattern = escaped; new RegExp(pattern)`).
const INITIALIZER_RESOLUTION_HOPS = 2;

const getRegExpCallee = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const rawCallee = isNodeOfType(node, "CallExpression")
    ? node.callee
    : isNodeOfType(node, "NewExpression")
      ? node.callee
      : null;
  const callee = rawCallee ? stripParenExpression(rawCallee as EsTreeNode) : null;
  return callee && isNodeOfType(callee, "Identifier") && callee.name === "RegExp" ? callee : null;
};

const isFullyLiteralPattern = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return true;
  if (isNodeOfType(stripped, "TemplateLiteral") && (stripped.expressions?.length ?? 0) === 0) {
    return true;
  }
  return false;
};

const isRegExpEscapeBuiltin = (callee: EsTreeNode): boolean => {
  const inner = stripParenExpression(callee);
  if (!isNodeOfType(inner, "MemberExpression")) return false;
  const receiver = stripParenExpression(inner.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "RegExp" &&
    !findVariableInitializer(receiver, "RegExp") &&
    getStaticPropertyName(inner) === "escape"
  );
};

const REGEXP_ESCAPE_PATTERN_CHARACTERS = [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|"];

const isEscapingReplaceCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    (getCalleeName(node) !== "replace" && getCalleeName(node) !== "replaceAll")
  ) {
    return false;
  }
  const [matchPattern, replacement] = node.arguments;
  if (
    !matchPattern ||
    !replacement ||
    !isNodeOfType(matchPattern, "Literal") ||
    !("regex" in matchPattern) ||
    !matchPattern.regex ||
    !isNodeOfType(replacement, "Literal") ||
    replacement.value !== "\\$&"
  ) {
    return false;
  }
  return (
    matchPattern.regex.pattern.includes("\\") &&
    REGEXP_ESCAPE_PATTERN_CHARACTERS.every((character) =>
      matchPattern.regex?.pattern.includes(character),
    )
  );
};

const helperEscapeCache = new WeakMap<EsTreeNode, boolean>();
const helpersBeingAnalyzed = new WeakSet<EsTreeNode>();

const referencesBinding = (identifier: EsTreeNode, bindingIdentifier: EsTreeNode): boolean =>
  isNodeOfType(identifier, "Identifier") &&
  findVariableInitializer(identifier, identifier.name)?.bindingIdentifier === bindingIdentifier;

const returnedExpressionIsEscaped = (
  expression: EsTreeNode,
  parameterBinding: EsTreeNode,
  bindingsBeingResolved: WeakSet<EsTreeNode>,
): boolean => {
  const inner = stripParenExpression(expression);
  if (isFullyLiteralPattern(inner)) return true;
  if (isNodeOfType(inner, "Identifier")) {
    if (referencesBinding(inner, parameterBinding)) return false;
    const binding = findVariableInitializer(inner, inner.name);
    if (!binding?.initializer || bindingsBeingResolved.has(binding.bindingIdentifier)) return false;
    bindingsBeingResolved.add(binding.bindingIdentifier);
    const isEscaped = returnedExpressionIsEscaped(
      binding.initializer,
      parameterBinding,
      bindingsBeingResolved,
    );
    bindingsBeingResolved.delete(binding.bindingIdentifier);
    return isEscaped;
  }
  if (isNodeOfType(inner, "CallExpression")) {
    if (
      isRegExpEscapeBuiltin(inner.callee) ||
      isEscapingReplaceCall(inner) ||
      isElementWiseEscapingMap(inner)
    ) {
      return true;
    }
    const calleeName = getCalleeName(inner);
    if (calleeName && ESCAPE_HELPER_NAME_PATTERN.test(calleeName)) return true;
    return calleeBindingBodyEscapes(inner);
  }
  if (isNodeOfType(inner, "BinaryExpression") || isNodeOfType(inner, "LogicalExpression")) {
    return (
      returnedExpressionIsEscaped(
        inner.left as EsTreeNode,
        parameterBinding,
        bindingsBeingResolved,
      ) &&
      returnedExpressionIsEscaped(
        inner.right as EsTreeNode,
        parameterBinding,
        bindingsBeingResolved,
      )
    );
  }
  if (isNodeOfType(inner, "ConditionalExpression")) {
    return (
      returnedExpressionIsEscaped(
        inner.consequent as EsTreeNode,
        parameterBinding,
        bindingsBeingResolved,
      ) &&
      returnedExpressionIsEscaped(
        inner.alternate as EsTreeNode,
        parameterBinding,
        bindingsBeingResolved,
      )
    );
  }
  if (isNodeOfType(inner, "TemplateLiteral")) {
    return inner.expressions.every((templateExpression) =>
      returnedExpressionIsEscaped(
        templateExpression as EsTreeNode,
        parameterBinding,
        bindingsBeingResolved,
      ),
    );
  }
  return false;
};

// `terms.map(escapeRegExp)` / `terms.map((t) => escapeRegExp(t))` /
// `terms.map((t) => t.replace(...))` — the rule's escape-first remediation
// applied element-wise before a `.join` alternation.
const isElementWiseEscapingMap = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "map"
  ) {
    return false;
  }
  const mapper = node.arguments?.[0] ? stripParenExpression(node.arguments[0] as EsTreeNode) : null;
  if (!mapper) return false;
  if (isNodeOfType(mapper, "Identifier")) return ESCAPE_HELPER_NAME_PATTERN.test(mapper.name);
  if (isNodeOfType(mapper, "MemberExpression")) return isRegExpEscapeBuiltin(mapper);
  if (
    isNodeOfType(mapper, "ArrowFunctionExpression") ||
    isNodeOfType(mapper, "FunctionExpression")
  ) {
    const firstParameter = mapper.params?.[0];
    if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;
    if (!isNodeOfType(mapper.body, "BlockStatement")) {
      return returnedExpressionIsEscaped(mapper.body as EsTreeNode, firstParameter, new WeakSet());
    }
    const returnExpressions: EsTreeNode[] = [];
    walkAst(mapper.body, (child: EsTreeNode) => {
      if (isFunctionLike(child)) return false;
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        returnExpressions.push(child.argument as EsTreeNode);
      }
    });
    return (
      returnExpressions.length > 0 &&
      returnExpressions.every((returnExpression) =>
        returnedExpressionIsEscaped(returnExpression, firstParameter, new WeakSet()),
      )
    );
  }
  return false;
};

// A same-file helper whose body performs the escape (`const
// escapeSpecialChars = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`)
// sanitizes regardless of whether its name matches the helper pattern; so
// does an ALIASED escape import (`import { escapeRegExp as esc }`), whose
// imported name carries the claim the local alias dropped.
const calleeBindingBodyEscapes = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  if (!binding?.initializer) return false;
  if (isNodeOfType(binding.initializer, "ImportSpecifier")) {
    const imported = binding.initializer.imported;
    return Boolean(
      isNodeOfType(imported, "Identifier") && ESCAPE_HELPER_NAME_PATTERN.test(imported.name),
    );
  }
  const helper = stripParenExpression(binding.initializer);
  if (!isFunctionLike(helper)) return false;
  const cachedResult = helperEscapeCache.get(helper);
  if (cachedResult !== undefined) return cachedResult;
  if (helpersBeingAnalyzed.has(helper)) return false;
  const firstParameter = helper.params?.[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;
  helpersBeingAnalyzed.add(helper);
  let returnExpressions: EsTreeNode[] = [];
  if (!isNodeOfType(helper.body, "BlockStatement")) {
    returnExpressions = [helper.body as EsTreeNode];
  } else {
    walkAst(helper.body, (child: EsTreeNode) => {
      if (isFunctionLike(child)) return false;
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        returnExpressions.push(child.argument as EsTreeNode);
      }
    });
  }
  const doesEscape =
    returnExpressions.length > 0 &&
    returnExpressions.every((returnExpression) =>
      returnedExpressionIsEscaped(returnExpression, firstParameter, new WeakSet()),
    );
  helpersBeingAnalyzed.delete(helper);
  helperEscapeCache.set(helper, doesEscape);
  return doesEscape;
};

// `new RegExp(getSearchFieldSource())` where the getter's every return is
// a literal — the "search" in the CALLEE name is a source-pattern getter,
// not a user term.
const isLiteralReturningGetterCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  const helper = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  if (
    !helper ||
    (!isNodeOfType(helper, "ArrowFunctionExpression") &&
      !isNodeOfType(helper, "FunctionExpression"))
  ) {
    return false;
  }
  if (!isNodeOfType(helper.body, "BlockStatement")) {
    return isFullyLiteralPattern(helper.body as EsTreeNode);
  }
  const returnedValues: EsTreeNode[] = [];
  walkAst(helper.body, (child: EsTreeNode) => {
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      returnedValues.push(child.argument as EsTreeNode);
    }
  });
  return returnedValues.length > 0 && returnedValues.every(isFullyLiteralPattern);
};

const isEscapingCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isRegExpEscapeBuiltin(node.callee)) return true;
  const calleeName = getCalleeName(node);
  if (calleeName && ESCAPE_HELPER_NAME_PATTERN.test(calleeName)) {
    return true;
  }
  return (
    isEscapingReplaceCall(node) || isElementWiseEscapingMap(node) || calleeBindingBodyEscapes(node)
  );
};

const isRegexSourceAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "source";

// Method/property name positions (`terms.filter(...)`, `{ query: x }`) are
// not value reads — only value-position identifiers can carry the term.
const isPropertyNamePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) {
    return parent.property === identifier && !parent.computed;
  }
  return isNodeOfType(parent, "Property") && parent.key === identifier && !parent.computed;
};

const isTypePositionIdentifier = (identifier: EsTreeNode): boolean => {
  let child = identifier;
  let ancestor = identifier.parent;
  while (ancestor) {
    if (
      (isNodeOfType(ancestor, "TSAsExpression") ||
        isNodeOfType(ancestor, "TSSatisfiesExpression") ||
        isNodeOfType(ancestor, "TSTypeAssertion") ||
        isNodeOfType(ancestor, "TSNonNullExpression")) &&
      ancestor.expression === child
    ) {
      child = ancestor;
      ancestor = ancestor.parent;
      continue;
    }
    return ancestor.type.startsWith("TS");
  }
  return false;
};

const collectRawSearchTermIdentifiers = (
  argument: EsTreeNode,
): EsTreeNodeOfType<"Identifier">[] => {
  const rawSearchTermIdentifiers: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(argument, (child: EsTreeNode) => {
    if (isEscapingCall(child) || isRegexSourceAccess(child)) return false;
    if (isLiteralReturningGetterCall(child)) return false;
    if (
      isNodeOfType(child, "Identifier") &&
      SEARCH_TERM_NAME_PATTERN.test(child.name) &&
      !isPropertyNamePosition(child) &&
      !isTypePositionIdentifier(child)
    ) {
      rawSearchTermIdentifiers.push(child);
    }
  });
  return rawSearchTermIdentifiers;
};

const collectLeafIdentifiers = (node: EsTreeNode): EsTreeNodeOfType<"Identifier">[] => {
  const leafIdentifiers: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(node, (child: EsTreeNode) => {
    if (isEscapingCall(child) || isRegexSourceAccess(child)) return false;
    if (isNodeOfType(child, "Identifier") && !isPropertyNamePosition(child)) {
      leafIdentifiers.push(child);
    }
  });
  return leafIdentifiers;
};

const compositeInitializerResolvesEscaped = (
  strippedInitializer: EsTreeNode,
  remainingHops: number,
  scopes: ScopeAnalysis,
  regexpObjectSymbolIds: ReadonlySet<number>,
  globalRegExpObjectNames: ReadonlySet<string>,
): boolean => {
  let didResolveAnyLeafEscaped = false;
  for (const leafIdentifier of collectLeafIdentifiers(strippedInitializer)) {
    if (
      identifierResolvesToEscapedValue(
        leafIdentifier,
        remainingHops,
        scopes,
        regexpObjectSymbolIds,
        globalRegExpObjectNames,
      )
    ) {
      didResolveAnyLeafEscaped = true;
    } else if (SEARCH_TERM_NAME_PATTERN.test(leafIdentifier.name)) {
      return false;
    }
  }
  return didResolveAnyLeafEscaped;
};

const initializerLooksEscaped = (
  initializer: EsTreeNode,
  remainingHops: number,
  scopes: ScopeAnalysis,
  regexpObjectSymbolIds: ReadonlySet<number>,
  globalRegExpObjectNames: ReadonlySet<string>,
): boolean => {
  const strippedInitializer = stripParenExpression(initializer);
  if (isFullyLiteralPattern(strippedInitializer)) return true;
  // A regex literal binding (`const re = /x/;` re-passed to `new RegExp`)
  // and a fully-literal keyword table (`["SELECT", "FROM"].join("|")`)
  // carry only developer-authored characters.
  if (isNodeOfType(strippedInitializer, "Literal") && "regex" in strippedInitializer) return true;
  if (
    isNodeOfType(strippedInitializer, "ArrayExpression") &&
    (strippedInitializer.elements ?? []).every(
      (element) => element && isFullyLiteralPattern(element as EsTreeNode),
    )
  ) {
    return true;
  }
  if (
    isNodeOfType(strippedInitializer, "CallExpression") &&
    (isEscapingCall(strippedInitializer) || calleeBindingBodyEscapes(strippedInitializer))
  ) {
    return true;
  }
  if (remainingHops > 0) {
    if (isNodeOfType(strippedInitializer, "Identifier")) {
      return identifierResolvesToEscapedValue(
        strippedInitializer,
        remainingHops - 1,
        scopes,
        regexpObjectSymbolIds,
        globalRegExpObjectNames,
      );
    }
    return compositeInitializerResolvesEscaped(
      strippedInitializer,
      remainingHops - 1,
      scopes,
      regexpObjectSymbolIds,
      globalRegExpObjectNames,
    );
  }
  return false;
};

const REGEXP_OBJECT_PROPERTY_NAMES = new Set(["flags", "global", "source", "sticky", "lastIndex"]);
const SCREAMING_SNAKE_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

interface RegExpObjectIndex {
  regexpObjectSymbolIds: ReadonlySet<number>;
  globalRegExpObjectNames: ReadonlySet<string>;
}

const buildRegExpObjectIndex = (root: EsTreeNode, scopes: ScopeAnalysis): RegExpObjectIndex => {
  const regexpObjectSymbolIds = new Set<number>();
  const globalRegExpObjectNames = new Set<string>();
  walkAst(root, (node: EsTreeNode) => {
    if (
      !isNodeOfType(node, "MemberExpression") ||
      node.computed ||
      !isNodeOfType(node.object, "Identifier") ||
      !isNodeOfType(node.property, "Identifier") ||
      !REGEXP_OBJECT_PROPERTY_NAMES.has(node.property.name)
    ) {
      return;
    }
    const symbol = scopes.symbolFor(node.object);
    if (symbol) {
      regexpObjectSymbolIds.add(symbol.id);
    } else if (scopes.isGlobalReference(node.object)) {
      globalRegExpObjectNames.add(node.object.name);
    }
  });
  return { regexpObjectSymbolIds, globalRegExpObjectNames };
};

// The identifier is a RegExp OBJECT, not a string: somewhere in the file
// the same name is read with a regex-only property (`searchPattern.flags`,
// `searchPattern.global`). `new RegExp(existingRegex, flags)` copies
// `.source` verbatim — escaping is meaningless there.
const isRegExpObjectIdentifier = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
  regexpObjectSymbolIds: ReadonlySet<number>,
  globalRegExpObjectNames: ReadonlySet<string>,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  return symbol
    ? regexpObjectSymbolIds.has(symbol.id)
    : globalRegExpObjectNames.has(identifier.name);
};

const identifierResolvesToEscapedValue = (
  identifier: EsTreeNodeOfType<"Identifier">,
  remainingHops: number,
  scopes: ScopeAnalysis,
  regexpObjectSymbolIds: ReadonlySet<number>,
  globalRegExpObjectNames: ReadonlySet<string>,
): boolean => {
  if (hasBindingWriteBetween(identifier, null, identifier, scopes)) return false;
  if (SANITIZED_NAME_PATTERN.test(identifier.name)) return true;
  // SCREAMING_SNAKE names are developer-authored pattern constants (often
  // imported, so their initializer is unresolvable) — the metacharacters
  // ARE the pattern.
  if (SCREAMING_SNAKE_CONSTANT_PATTERN.test(identifier.name)) return true;
  if (
    isRegExpObjectIdentifier(identifier, scopes, regexpObjectSymbolIds, globalRegExpObjectNames)
  ) {
    return true;
  }
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  return initializerLooksEscaped(
    binding.initializer,
    remainingHops,
    scopes,
    regexpObjectSymbolIds,
    globalRegExpObjectNames,
  );
};

const REGEXP_METACHARACTER_PATTERN = /[\\^$.*+?()[\]{}|]/;

const literalStringValue = (node: EsTreeNode): string | null => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Literal") && typeof inner.value === "string") return inner.value;
  if (isNodeOfType(inner, "TemplateLiteral") && (inner.expressions?.length ?? 0) === 0) {
    return inner.quasis[0]?.value.cooked ?? null;
  }
  return null;
};

const isDirectlyExported = (declarationNode: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = declarationNode.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "ExportNamedDeclaration") ||
      isNodeOfType(ancestor, "ExportDefaultDeclaration")
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "Program")) return false;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A parameter of a module-private function whose EVERY same-file call site
// passes a metacharacter-free string literal (`parseLengthAfter(text,
// "margin")`) carries only developer-typed characters, never a runtime
// search term — the "keyword" in the parameter name is the caller's fixed
// vocabulary. Bails when the function is exported or its name escapes call
// position (either lets unseen callers pass dynamic values).
const isParameterFedOnlyMetacharacterFreeLiterals = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding || binding.initializer !== null) return false;
  const owner = binding.scopeOwner;
  if (!isFunctionLike(owner)) return false;
  const parameterIndex = (owner.params ?? []).findIndex(
    (param) => param === binding.bindingIdentifier,
  );
  if (parameterIndex < 0) return false;
  let functionName: string | null = null;
  let declarationIdentifier: EsTreeNode | null = null;
  let declarationNode: EsTreeNode = owner;
  if (isNodeOfType(owner, "FunctionDeclaration") && owner.id) {
    functionName = owner.id.name;
    declarationIdentifier = owner.id;
  } else {
    const ownerParent = owner.parent;
    if (
      ownerParent &&
      isNodeOfType(ownerParent, "VariableDeclarator") &&
      isNodeOfType(ownerParent.id, "Identifier")
    ) {
      functionName = ownerParent.id.name;
      declarationIdentifier = ownerParent.id;
      declarationNode = ownerParent;
    }
  }
  if (!functionName || !declarationIdentifier) return false;
  if (isDirectlyExported(declarationNode)) return false;
  const functionSymbol = scopes.scopeFor(declarationIdentifier).symbolsByName.get(functionName);
  if (!functionSymbol) return false;
  let doesNameEscapeCallPosition = false;
  const callSiteArguments: (EsTreeNode | undefined)[] = [];
  for (const reference of functionSymbol.references) {
    const referenceParent = reference.identifier.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "CallExpression") &&
      referenceParent.callee === reference.identifier
    ) {
      callSiteArguments.push(referenceParent.arguments?.[parameterIndex]);
      continue;
    }
    doesNameEscapeCallPosition = true;
    break;
  }
  if (doesNameEscapeCallPosition || callSiteArguments.length === 0) return false;
  return callSiteArguments.every((callArgument) => {
    if (!callArgument || isNodeOfType(callArgument, "SpreadElement")) return false;
    const literalValue = literalStringValue(callArgument);
    return literalValue !== null && !REGEXP_METACHARACTER_PATTERN.test(literalValue);
  });
};

// A dominating guard already shape-tested the term (`if
// (!/^[\w\s]*$/.test(query)) return value.includes(query);`) — the
// construction only runs on metacharacter-free values.
const isShapeTestedByDominatingGuard = (
  constructionNode: EsTreeNode,
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const isSafeCharacterClassTest = (candidate: EsTreeNode): boolean => {
    const inner = stripParenExpression(candidate);
    if (
      !isNodeOfType(inner, "CallExpression") ||
      !isNodeOfType(inner.callee, "MemberExpression") ||
      getCalleeName(inner) !== "test"
    ) {
      return false;
    }
    const receiver = stripParenExpression(inner.callee.object as EsTreeNode);
    if (!isNodeOfType(receiver, "Literal") || !("regex" in receiver) || !receiver.regex) {
      return false;
    }
    const argument = inner.arguments[0];
    if (!argument || !isNodeOfType(argument, "Identifier")) {
      return false;
    }
    const guardedSymbol = scopes.symbolFor(argument);
    const constructedSymbol = scopes.symbolFor(identifier);
    if (
      guardedSymbol
        ? guardedSymbol !== constructedSymbol
        : constructedSymbol !== null || argument.name !== identifier.name
    ) {
      return false;
    }
    const classMatch = receiver.regex.pattern.match(/^\^\[([^\]]+)\][*+]\$$/);
    if (!classMatch?.[1] || classMatch[1].startsWith("^")) return false;
    const unsupportedCharacters = classMatch[1]
      .replaceAll(/A-Z|a-z|0-9/g, "")
      .replaceAll(/\\[dsw]/g, "")
      .replaceAll(/[A-Za-z0-9_ #,:/-]/g, "");
    return unsupportedCharacters.length === 0;
  };
  const shapeTestPolarity = (guardTest: EsTreeNode): boolean | null => {
    const inner = stripParenExpression(guardTest);
    if (isSafeCharacterClassTest(inner)) return true;
    if (
      isNodeOfType(inner, "UnaryExpression") &&
      inner.operator === "!" &&
      isSafeCharacterClassTest(inner.argument as EsTreeNode)
    ) {
      return false;
    }
    return null;
  };
  let child: EsTreeNode = constructionNode;
  let ancestor: EsTreeNode | null | undefined = constructionNode.parent;
  while (ancestor) {
    if (
      (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
      ((ancestor.consequent === child && shapeTestPolarity(ancestor.test) === true) ||
        ("alternate" in ancestor &&
          ancestor.alternate === child &&
          shapeTestPolarity(ancestor.test) === false))
    ) {
      if (!hasBindingWriteBetween(identifier, ancestor.test, constructionNode, scopes)) return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const childStatementIndex = statements.findIndex((statement) => statement === child);
      for (const precedingStatement of statements.slice(0, Math.max(childStatementIndex, 0))) {
        if (
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitStatement(precedingStatement.consequent) &&
          shapeTestPolarity(precedingStatement.test) === false
        ) {
          if (
            !hasBindingWriteBetween(identifier, precedingStatement.test, constructionNode, scopes)
          ) {
            return true;
          }
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const normalizeRegexValidationArgument = (node: EsTreeNode): EsTreeNode => {
  const inner = stripParenExpression(node);
  if (
    isNodeOfType(inner, "LogicalExpression") &&
    (inner.operator === "??" || inner.operator === "||") &&
    literalStringValue(inner.right as EsTreeNode) === ""
  ) {
    return stripParenExpression(inner.left as EsTreeNode);
  }
  return inner;
};

const trustedRegexValidatorPolarity = (
  test: EsTreeNode,
  constructedArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean | null => {
  const inner = stripParenExpression(test);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    const nestedPolarity = trustedRegexValidatorPolarity(
      inner.argument as EsTreeNode,
      constructedArgument,
      scopes,
    );
    return nestedPolarity === null ? null : !nestedPolarity;
  }
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    return binding?.initializer
      ? trustedRegexValidatorPolarity(binding.initializer, constructedArgument, scopes)
      : null;
  }
  if (!isNodeOfType(inner, "CallExpression")) return null;
  const callee = stripParenExpression(inner.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const importBinding = getImportBindingForName(callee, callee.name);
  if (
    importBinding?.source !== "lib/utils/regexp" ||
    importBinding.exportedName !== "isValidRegexp"
  ) {
    return null;
  }
  const validatedArgument = inner.arguments[0];
  if (!validatedArgument || isNodeOfType(validatedArgument, "SpreadElement")) return null;
  const normalizedValidatedArgument = normalizeRegexValidationArgument(validatedArgument);
  const normalizedConstructedArgument = normalizeRegexValidationArgument(constructedArgument);
  if (
    isNodeOfType(normalizedValidatedArgument, "Identifier") &&
    isNodeOfType(normalizedConstructedArgument, "Identifier")
  ) {
    const validatedSymbol = scopes.symbolFor(normalizedValidatedArgument);
    const constructedSymbol = scopes.symbolFor(normalizedConstructedArgument);
    if (validatedSymbol) return validatedSymbol === constructedSymbol ? true : null;
    return constructedSymbol === null &&
      normalizedValidatedArgument.name === normalizedConstructedArgument.name
      ? true
      : null;
  }
  return areExpressionsStructurallyEqual(normalizedValidatedArgument, normalizedConstructedArgument)
    ? true
    : null;
};

const isGuardedByTrustedRegexValidator = (
  constructionNode: EsTreeNode,
  constructedArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const normalizedConstructedArgument = normalizeRegexValidationArgument(constructedArgument);
  const hasWriteAfterValidation = (validationNode: EsTreeNode): boolean =>
    isNodeOfType(normalizedConstructedArgument, "Identifier") &&
    hasBindingWriteBetween(normalizedConstructedArgument, validationNode, constructionNode, scopes);
  let child = constructionNode;
  let ancestor = constructionNode.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      trustedRegexValidatorPolarity(ancestor.test, constructedArgument, scopes) === true &&
      !hasWriteAfterValidation(ancestor.test)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childStatementIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const precedingStatement of ancestor.body.slice(0, Math.max(childStatementIndex, 0))) {
        if (
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitStatement(precedingStatement.consequent) &&
          trustedRegexValidatorPolarity(precedingStatement.test, constructedArgument, scopes) ===
            false &&
          !hasWriteAfterValidation(precedingStatement.test)
        ) {
          return true;
        }
      }
    }
    if (isFunctionLike(ancestor)) return false;
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noUnescapedDynamicStringInRegexp = defineRule({
  id: "no-unescaped-dynamic-string-in-regexp",
  title: "Unescaped dynamic string in RegExp constructor",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "A search/filter/highlight term dropped straight into `new RegExp(...)` lets its regex metacharacters act as operators, so a user typing `.` or `(` over-matches or throws. Escape the value with an `escapeRegExp` helper before constructing the pattern.",
  create: (context: RuleContext): RuleVisitors => {
    if (TEST_CONTEXT_FILE_PATTERN.test(context.filename ?? "")) return {};
    let regexpObjectIndex: RegExpObjectIndex | null = null;
    const reportUnescapedConstruction = (
      node: EsTreeNodeOfType<"CallExpression"> | EsTreeNodeOfType<"NewExpression">,
    ): void => {
      const regExpCallee = getRegExpCallee(node);
      if (!regExpCallee || !context.scopes.isGlobalReference(regExpCallee)) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
      if (isFullyLiteralPattern(firstArgument)) return;
      if (isGuardedByTrustedRegexValidator(node, firstArgument, context.scopes)) return;
      if (!regexpObjectIndex) {
        const programRoot = findProgramRoot(node);
        if (!programRoot) return;
        regexpObjectIndex = buildRegExpObjectIndex(programRoot, context.scopes);
      }
      const currentRegExpObjectIndex = regexpObjectIndex;
      const rawSearchTermIdentifiers = collectRawSearchTermIdentifiers(firstArgument);
      const hasUnescapedSearchTerm = rawSearchTermIdentifiers.some(
        (identifier) =>
          !identifierResolvesToEscapedValue(
            identifier,
            INITIALIZER_RESOLUTION_HOPS,
            context.scopes,
            currentRegExpObjectIndex.regexpObjectSymbolIds,
            currentRegExpObjectIndex.globalRegExpObjectNames,
          ) &&
          !isShapeTestedByDominatingGuard(node, identifier, context.scopes) &&
          !isParameterFedOnlyMetacharacterFreeLiterals(identifier, context.scopes),
      );
      if (!hasUnescapedSearchTerm) return;
      context.report({
        node,
        message:
          "This builds a `RegExp` from a dynamic search/filter term without escaping it, so regex metacharacters in the value act as operators and over-match or throw. Escape the value with an `escapeRegExp` helper first.",
      });
    };
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        reportUnescapedConstruction(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        reportUnescapedConstruction(node);
      },
    };
  },
});
