import { defineRule } from "../../utils/define-rule.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

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
  const callee = isNodeOfType(node, "CallExpression")
    ? node.callee
    : isNodeOfType(node, "NewExpression")
      ? node.callee
      : null;
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

const isRegExpEscapeBuiltin = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  isNodeOfType(callee.object, "Identifier") &&
  callee.object.name === "RegExp" &&
  isNodeOfType(callee.property, "Identifier") &&
  callee.property.name === "escape";

const containsEscapingCall = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (isEscapingCall(child)) {
      found = true;
      return false;
    }
  });
  return found;
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
    return containsEscapingCall(mapper.body as EsTreeNode);
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
  return containsEscapingCall(binding.initializer);
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
  if (
    calleeName &&
    (ESCAPE_HELPER_NAME_PATTERN.test(calleeName) ||
      calleeName === "replace" ||
      calleeName === "replaceAll")
  ) {
    return true;
  }
  return isElementWiseEscapingMap(node) || calleeBindingBodyEscapes(node);
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
): boolean => {
  let didResolveAnyLeafEscaped = false;
  for (const leafIdentifier of collectLeafIdentifiers(strippedInitializer)) {
    if (identifierResolvesToEscapedValue(leafIdentifier, remainingHops)) {
      didResolveAnyLeafEscaped = true;
    } else if (SEARCH_TERM_NAME_PATTERN.test(leafIdentifier.name)) {
      return false;
    }
  }
  return didResolveAnyLeafEscaped;
};

const initializerLooksEscaped = (initializer: EsTreeNode, remainingHops: number): boolean => {
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
  if (containsEscapingCall(strippedInitializer)) return true;
  if (remainingHops > 0) {
    if (isNodeOfType(strippedInitializer, "Identifier")) {
      return identifierResolvesToEscapedValue(strippedInitializer, remainingHops - 1);
    }
    return compositeInitializerResolvesEscaped(strippedInitializer, remainingHops - 1);
  }
  return false;
};

const REGEXP_OBJECT_PROPERTY_NAMES = new Set(["flags", "global", "source", "sticky", "lastIndex"]);
const SCREAMING_SNAKE_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// The identifier is a RegExp OBJECT, not a string: somewhere in the file
// the same name is read with a regex-only property (`searchPattern.flags`,
// `searchPattern.global`). `new RegExp(existingRegex, flags)` copies
// `.source` verbatim — escaping is meaningless there.
const isRegExpObjectIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  let root: EsTreeNode = identifier;
  while (root.parent) root = root.parent;
  let proven = false;
  walkAst(root, (child: EsTreeNode) => {
    if (proven) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === identifier.name &&
      isNodeOfType(child.property, "Identifier") &&
      REGEXP_OBJECT_PROPERTY_NAMES.has(child.property.name)
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
};

const identifierResolvesToEscapedValue = (
  identifier: EsTreeNodeOfType<"Identifier">,
  remainingHops: number,
): boolean => {
  if (SANITIZED_NAME_PATTERN.test(identifier.name)) return true;
  // SCREAMING_SNAKE names are developer-authored pattern constants (often
  // imported, so their initializer is unresolvable) — the metacharacters
  // ARE the pattern.
  if (SCREAMING_SNAKE_CONSTANT_PATTERN.test(identifier.name)) return true;
  if (isRegExpObjectIdentifier(identifier)) return true;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  return initializerLooksEscaped(binding.initializer, remainingHops);
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
  let programRoot: EsTreeNode = owner;
  while (programRoot.parent) programRoot = programRoot.parent;
  let doesNameEscapeCallPosition = false;
  const callSiteArguments: (EsTreeNode | undefined)[] = [];
  walkAst(programRoot, (child: EsTreeNode) => {
    if (doesNameEscapeCallPosition) return false;
    if (isNodeOfType(child, "ExportSpecifier")) {
      const local = child.local;
      if (isNodeOfType(local, "Identifier") && local.name === functionName) {
        doesNameEscapeCallPosition = true;
        return false;
      }
    }
    if (!isNodeOfType(child, "Identifier") || child.name !== functionName) return;
    if (child === declarationIdentifier) return;
    if (isPropertyNamePosition(child)) return;
    const referenceParent = child.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "CallExpression") &&
      referenceParent.callee === child
    ) {
      callSiteArguments.push(referenceParent.arguments?.[parameterIndex]);
      return;
    }
    doesNameEscapeCallPosition = true;
    return false;
  });
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
  identifierName: string,
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
    if (!argument || !isNodeOfType(argument, "Identifier") || argument.name !== identifierName) {
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
      return true;
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
          return true;
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
): boolean | null => {
  const inner = stripParenExpression(test);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    const nestedPolarity = trustedRegexValidatorPolarity(
      inner.argument as EsTreeNode,
      constructedArgument,
    );
    return nestedPolarity === null ? null : !nestedPolarity;
  }
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    return binding?.initializer
      ? trustedRegexValidatorPolarity(binding.initializer, constructedArgument)
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
  return areExpressionsStructurallyEqual(
    normalizeRegexValidationArgument(validatedArgument),
    normalizeRegexValidationArgument(constructedArgument),
  )
    ? true
    : null;
};

const isGuardedByTrustedRegexValidator = (
  constructionNode: EsTreeNode,
  constructedArgument: EsTreeNode,
): boolean => {
  let child = constructionNode;
  let ancestor = constructionNode.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      trustedRegexValidatorPolarity(ancestor.test, constructedArgument) === true
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childStatementIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const precedingStatement of ancestor.body.slice(0, Math.max(childStatementIndex, 0))) {
        if (
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitStatement(precedingStatement.consequent) &&
          trustedRegexValidatorPolarity(precedingStatement.test, constructedArgument) === false
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
    const reportUnescapedConstruction = (
      node: EsTreeNodeOfType<"CallExpression"> | EsTreeNodeOfType<"NewExpression">,
    ): void => {
      const regExpCallee = getRegExpCallee(node);
      if (!regExpCallee || !context.scopes.isGlobalReference(regExpCallee)) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
      if (isFullyLiteralPattern(firstArgument)) return;
      if (isGuardedByTrustedRegexValidator(node, firstArgument)) return;
      const rawSearchTermIdentifiers = collectRawSearchTermIdentifiers(firstArgument);
      const hasUnescapedSearchTerm = rawSearchTermIdentifiers.some(
        (identifier) =>
          !identifierResolvesToEscapedValue(identifier, INITIALIZER_RESOLUTION_HOPS) &&
          !isShapeTestedByDominatingGuard(node, identifier.name) &&
          !isParameterFedOnlyMetacharacterFreeLiterals(identifier),
      );
      if (!hasUnescapedSearchTerm) return;
      if (isInsideTryStatement(node, { region: "block" })) return;
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
