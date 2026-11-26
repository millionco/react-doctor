import { hasClosedNumericStateWrites } from "./utils/has-closed-numeric-state-writes.js";
import { BUILTIN_GLOBAL_NAMESPACE_NAMES } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactUseCallbackCall } from "../../utils/get-react-use-callback-call.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenStyledComponentExpression } from "../../utils/is-proven-styled-component-expression.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import {
  resolveCrossFileExport,
  type ResolvedCrossFileExport,
} from "../../utils/resolve-cross-file-export.js";
import { resolveRelativeImportPath } from "../../utils/resolve-relative-import-path.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { Reference } from "eslint-scope";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getDownstreamRefs,
  getEventualCallRefsTo,
  getRef,
  getUpstreamRefs,
} from "./utils/effect/ast.js";
import { readsPostMountValueThroughLocals } from "./utils/reads-post-mount-through-locals.js";
import { createStateTriggerReachability } from "./utils/create-state-trigger-reachability.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import { isStableProjectedEffectDependency } from "./utils/is-stable-projected-effect-dependency.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isState,
  isSyncStateSetterCall,
  resolveStateSetterReference,
} from "./utils/effect/react.js";

// Port of upstream `src/rules/no-chain-state-updates.js`, plus the
// guarded-self-sync exemption below (prod telemetry review 2026-07).

const APPLICABLE_EFFECT_HOOK_NAMES: ReadonlySet<string> = new Set(["useEffect", "useLayoutEffect"]);

const getUseStateDeclarator = (ref: Reference): EsTreeNode | null =>
  (ref.resolved?.defs ?? [])
    .map((def) => def.node as unknown as EsTreeNode)
    .find(
      (node) => isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "ArrayPattern"),
    ) ?? null;

const isDeclaredWithin = (node: EsTreeNode, container: EsTreeNode): boolean => {
  let walker: EsTreeNode | null | undefined = node;
  while (walker) {
    if (walker === container) return true;
    walker = (walker as unknown as { parent?: EsTreeNode | null }).parent;
  }
  return false;
};

const isBuiltinNamespaceCallee = (callee: EsTreeNode | null | undefined): boolean => {
  if (!callee) return false;
  if (isNodeOfType(callee, "Identifier")) return BUILTIN_GLOBAL_NAMESPACE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression")) {
    const rootName = getRootIdentifierName(callee);
    return rootName !== null && BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName);
  }
  return false;
};

const getDependencyStateRefs = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyReference: Reference,
): Reference[] => {
  const useCallbackCall = getReactUseCallbackCall(
    dependencyReference.identifier as unknown as EsTreeNode,
    context.scopes,
  );
  if (!useCallbackCall) {
    return getUpstreamRefs(analysis, dependencyReference).filter((reference) =>
      isState(analysis, reference),
    );
  }
  const dependencyList = useCallbackCall.arguments?.[1];
  if (!dependencyList || !isNodeOfType(dependencyList, "ArrayExpression")) {
    return getUpstreamRefs(analysis, dependencyReference).filter((reference) =>
      isState(analysis, reference),
    );
  }
  return getDownstreamRefs(analysis, dependencyList)
    .flatMap((reference) => getUpstreamRefs(analysis, reference))
    .filter((reference) => isState(analysis, reference));
};

// A "simple" setter argument only re-derives from values already in the
// render scope: no calls (built-in namespace calls like `Math.max` are
// allowed), no `new`, no `await`, no function expressions (functional
// updaters read current state). Identifiers declared inside the effect
// must themselves have call-free initializers — `setEditor(newEditor)`
// where `newEditor = createEditor(...)` creates an external system in
// the effect and stays a chain.
const isSimpleExpression = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  effectFn: EsTreeNode,
  visitedDeclarators: WeakSet<object>,
): boolean => {
  let isSimple = true;
  walkAst(expression, (child: EsTreeNode) => {
    if (!isSimple) return false;
    if (
      isFunctionLike(child) ||
      isNodeOfType(child, "AwaitExpression") ||
      isNodeOfType(child, "NewExpression")
    ) {
      isSimple = false;
      return false;
    }
    if (isNodeOfType(child, "CallExpression") && !isBuiltinNamespaceCallee(child.callee)) {
      isSimple = false;
      return false;
    }
    if (isNodeOfType(child, "Identifier")) {
      const ref = getRef(analysis, child);
      const declarator = (ref?.resolved?.defs ?? [])
        .map((def) => def.node as unknown as EsTreeNode)
        .find((node) => isNodeOfType(node, "VariableDeclarator"));
      if (
        declarator &&
        isDeclaredWithin(declarator, effectFn) &&
        !visitedDeclarators.has(declarator)
      ) {
        visitedDeclarators.add(declarator);
        const initializer = isNodeOfType(declarator, "VariableDeclarator")
          ? (declarator.init as EsTreeNode | null)
          : null;
        if (
          initializer &&
          !isSimpleExpression(analysis, initializer, effectFn, visitedDeclarators)
        ) {
          isSimple = false;
          return false;
        }
      }
    }
  });
  return isSimple;
};

const getNumericSentinel = (value: EsTreeNode, context: RuleContext): number | null => {
  const symbol = isNodeOfType(value, "Identifier")
    ? resolveConstIdentifierAlias(value, context.scopes)
    : null;
  const expression = symbol?.kind === "const" ? symbol.initializer : value;
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return Number.isFinite(expression.value) ? expression.value : null;
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "-" &&
    isNodeOfType(expression.argument, "Literal") &&
    typeof expression.argument.value === "number" &&
    Number.isFinite(expression.argument.value)
  ) {
    return -expression.argument.value;
  }
  return null;
};

const hasSameStateSentinelGuard = (
  call: EsTreeNode,
  state: Reference,
  sentinel: number,
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectFunction: EsTreeNode,
): boolean => {
  const statement = call.parent;
  const block = statement?.parent;
  const branch = block?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.consequent !== block
  ) {
    return false;
  }
  const stateDeclarator = getUseStateDeclarator(state);
  const readsGuard = (test: EsTreeNode): boolean => {
    if (isNodeOfType(test, "LogicalExpression") && test.operator === "&&") {
      return readsGuard(test.left) || readsGuard(test.right);
    }
    return (
      isNodeOfType(test, "BinaryExpression") &&
      (test.operator === "!==" ||
        (test.operator === ">" &&
          stateDeclarator !== null &&
          hasClosedNumericStateWrites(stateDeclarator, context))) &&
      isNodeOfType(test.left, "Identifier") &&
      getRef(analysis, test.left)?.resolved === state.resolved &&
      Object.is(getNumericSentinel(test.right, context), sentinel)
    );
  };
  if (readsGuard(branch.test)) return true;
  const stateDeclaration = stateDeclarator?.parent;
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclaration") ||
    stateDeclaration.kind !== "const" ||
    !isFunctionLike(effectFunction) ||
    branch.parent !== effectFunction.body
  ) {
    return false;
  }
  const [sentinelExit] = block.body;
  if (
    !isNodeOfType(sentinelExit, "IfStatement") ||
    sentinelExit.alternate ||
    !isNodeOfType(sentinelExit.test, "BinaryExpression") ||
    sentinelExit.test.operator !== "===" ||
    !isNodeOfType(sentinelExit.test.left, "Identifier") ||
    getRef(analysis, sentinelExit.test.left)?.resolved !== state.resolved ||
    !Object.is(getNumericSentinel(sentinelExit.test.right, context), sentinel) ||
    !isNodeOfType(sentinelExit.consequent, "BlockStatement")
  ) {
    return false;
  }
  const terminalStatement = sentinelExit.consequent.body.at(-1);
  return isNodeOfType(terminalStatement, "ReturnStatement") && terminalStatement.argument === null;
};

const isStyledInputMember = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === "input" &&
  isDirectStyledFactory(node.object, scopes);

const isDirectStyledFactory = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return declaration?.source.value === "styled-components";
};

const hasStableStyledBinding = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  symbol.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    const parent = identifier.parent;
    if (!parent) return false;
    if (
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    ) {
      return true;
    }
    if (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === identifier) {
      return true;
    }
    if (isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier) return true;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === identifier &&
      isDirectStyledFactory(parent.callee, scopes) &&
      isNodeOfType(parent.parent, "TaggedTemplateExpression") &&
      parent.parent.tag === parent
    ) {
      return true;
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.computed ||
      parent.object !== identifier
    ) {
      return false;
    }
    const member = getStaticPropertyName(parent);
    const assignment = parent.parent;
    return (
      (member === "displayName" || member === "propTypes") &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === parent
    );
  });

// Accept only a stock input with attrs that add presentation data and
// pass the remaining props through unchanged. In particular, neither wrapper
// may synthesize a focus handler or substitute the element being focused.
const isStyledInputLeaf = (candidate: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(candidate, "TaggedTemplateExpression") ||
    !isProvenStyledComponentExpression(candidate, scopes)
  ) {
    return false;
  }
  const declaration = candidate.parent;
  if (isNodeOfType(declaration, "VariableDeclarator") && declaration.init === candidate) {
    const binding = scopes.symbolFor(declaration.id);
    if (binding?.kind !== "const" || !hasStableStyledBinding(binding, scopes)) return false;
  } else if (!isNodeOfType(declaration, "ExportDefaultDeclaration")) {
    return false;
  }
  const tag = candidate.tag;
  if (isStyledInputMember(tag, scopes)) return true;
  if (
    !isNodeOfType(tag, "CallExpression") ||
    tag.optional ||
    tag.arguments.length !== 1 ||
    !isNodeOfType(tag.callee, "MemberExpression") ||
    tag.callee.computed ||
    tag.callee.optional ||
    getStaticPropertyName(tag.callee) !== "attrs" ||
    !isStyledInputMember(tag.callee.object, scopes)
  ) {
    return false;
  }
  const [attrs] = tag.arguments;
  if (
    !isNodeOfType(attrs, "ArrowFunctionExpression") ||
    attrs.async ||
    attrs.params.length !== 1 ||
    !isNodeOfType(attrs.params[0], "ObjectPattern") ||
    attrs.params[0].properties.length !== 2
  ) {
    return false;
  }
  const attrsValue = stripParenExpression(attrs.body);
  if (!isNodeOfType(attrsValue, "ObjectExpression") || attrsValue.properties.length !== 3) {
    return false;
  }
  const [themeProp, rest] = attrs.params[0].properties;
  if (
    !isNodeOfType(themeProp, "Property") ||
    themeProp.computed ||
    getStaticPropertyKeyName(themeProp) !== "theme" ||
    !isNodeOfType(themeProp.value, "Identifier") ||
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier")
  ) {
    return false;
  }
  const [theme, skin, passthrough] = attrsValue.properties;
  if (
    !isNodeOfType(theme, "Property") ||
    theme.computed ||
    theme.kind !== "init" ||
    getStaticPropertyKeyName(theme) !== "theme" ||
    !isNodeOfType(theme.value, "ObjectExpression") ||
    !isNodeOfType(skin, "Property") ||
    skin.computed ||
    skin.kind !== "init" ||
    getStaticPropertyKeyName(skin) !== "skin" ||
    !isNodeOfType(skin.value, "Literal") ||
    typeof skin.value.value !== "string" ||
    !isNodeOfType(passthrough, "SpreadElement") ||
    !isNodeOfType(passthrough.argument, "Identifier")
  ) {
    return false;
  }
  const restSymbol = scopes.symbolFor(rest.argument);
  const themeSymbol = scopes.symbolFor(themeProp.value);
  return Boolean(
    restSymbol &&
    themeSymbol &&
    scopes.symbolFor(passthrough.argument) === restSymbol &&
    theme.value.properties.every((entry) =>
      isNodeOfType(entry, "SpreadElement")
        ? scopes.symbolFor(entry.argument) === themeSymbol
        : isNodeOfType(entry, "Property") &&
          !entry.computed &&
          entry.kind === "init" &&
          isNodeOfType(entry.value, "Identifier"),
    ),
  );
};

const isRelativeSpecifier = (value: unknown): value is string =>
  typeof value === "string" && (value.startsWith("./") || value.startsWith("../"));

const resolveDirectStyledInputExport = (
  filename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  if (!isRelativeSpecifier(source)) return null;
  const selectedPath = resolveRelativeImportPath(filename, source);
  if (!selectedPath) return null;
  const resolved = resolveCrossFileExport(filename, source, exportedName);
  if (
    !resolved ||
    resolved.filePath !== selectedPath ||
    !isNodeOfType(resolved.programNode, "Program") ||
    resolved.programNode.body.some(
      (entry) => isNodeOfType(entry, "ImportDeclaration") && entry.specifiers.length === 0,
    )
  ) {
    return null;
  }
  return resolved;
};

export const resolveStyledInputLeaf = (
  filename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  const direct = resolveDirectStyledInputExport(filename, source, exportedName);
  if (!direct || !isNodeOfType(direct.node, "Identifier")) return direct;
  // A barrel may import a binding and re-export it in a separate
  // statement. Follow one relative import from an import/export-only module.
  const barrel = direct.programNode;
  if (!isNodeOfType(barrel, "Program")) return null;
  let localName: string | null = null;
  for (const entry of barrel.body) {
    if (isNodeOfType(entry, "ImportDeclaration")) continue;
    if (
      !isNodeOfType(entry, "ExportNamedDeclaration") ||
      entry.source ||
      entry.declaration ||
      entry.exportKind === "type"
    ) {
      return null;
    }
    for (const specifier of entry.specifiers) {
      if (
        !isNodeOfType(specifier, "ExportSpecifier") ||
        specifier.exportKind === "type" ||
        !isNodeOfType(specifier.exported, "Identifier") ||
        specifier.exported.name !== exportedName
      ) {
        continue;
      }
      if (localName || !isNodeOfType(specifier.local, "Identifier")) return null;
      localName = specifier.local.name;
    }
  }
  const binding = localName && getImportBindingForName(barrel, localName);
  if (!binding || binding.isNamespace || !binding.exportedName) return null;
  return resolveDirectStyledInputExport(direct.filePath, binding.source, binding.exportedName);
};

const isLocalStyledInputComponent = (tag: EsTreeNode, context: RuleContext): boolean => {
  const symbol = context.scopes.symbolFor(tag);
  const initializer = symbol?.initializer;
  if (symbol?.kind !== "const" || !initializer || !hasStableStyledBinding(symbol, context.scopes)) {
    return false;
  }
  if (isStyledInputLeaf(initializer, context.scopes)) return true;
  if (
    !context.filename ||
    !isNodeOfType(initializer, "TaggedTemplateExpression") ||
    !isNodeOfType(initializer.tag, "CallExpression") ||
    initializer.tag.optional ||
    !isDirectStyledFactory(initializer.tag.callee, context.scopes) ||
    initializer.tag.arguments.length !== 1 ||
    !isNodeOfType(initializer.tag.arguments[0], "Identifier")
  ) {
    return false;
  }
  const wrapped = context.scopes.symbolFor(initializer.tag.arguments[0]);
  if (!wrapped || !hasStableStyledBinding(wrapped, context.scopes)) return false;
  if (wrapped.kind === "const" && wrapped.initializer) {
    return isStyledInputLeaf(wrapped.initializer, context.scopes);
  }
  const declaration = getImportDeclarationForSymbol(wrapped);
  const source = declaration?.source.value;
  const exportedName = isNodeOfType(wrapped.declarationNode, "ImportDefaultSpecifier")
    ? "default"
    : getImportedName(wrapped.declarationNode);
  if (!isRelativeSpecifier(source) || !exportedName) return false;
  const resolved = resolveStyledInputLeaf(context.filename, source, exportedName);
  return Boolean(resolved && isStyledInputLeaf(resolved.node, analyzeScopes(resolved.programNode)));
};

const FOCUS_PROP_PATTERN = /^on(?:Focus|Blur)(?:In|Out)?(?:Capture)?$/i;

const hasClosedFocusRefWiring = (
  ref: SymbolDescriptor,
  acquisition: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  let attachments = 0;
  for (const { identifier, flag } of ref.references) {
    if (flag !== "read") return false;
    const parent = identifier.parent;
    if (parent === acquisition) continue;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === identifier &&
      !parent.computed &&
      getStaticPropertyName(parent) === "current"
    ) {
      const comparison = parent.parent;
      if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===") {
        return false;
      }
      const other = comparison.left === parent ? comparison.right : comparison.left;
      if (
        !isNodeOfType(other, "MemberExpression") ||
        getStaticPropertyName(other) !== "activeElement" ||
        !isNodeOfType(other.object, "Identifier") ||
        other.object.name !== "document" ||
        context.scopes.symbolFor(other.object)
      ) {
        return false;
      }
      continue;
    }
    const attribute = parent?.parent;
    const opening = attribute?.parent;
    if (
      !isNodeOfType(parent, "JSXExpressionContainer") ||
      parent.expression !== identifier ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      getJsxAttributeName(attribute.name) !== "ref" ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      findEnclosingFunction(opening) !== component ||
      opening.attributes.some(
        (entry) =>
          isNodeOfType(entry, "JSXAttribute") &&
          (getJsxAttributeName(entry.name) === "as" ||
            getJsxAttributeName(entry.name) === "forwardedAs"),
      )
    ) {
      return false;
    }
    if (opening.name.name !== "input" && !isLocalStyledInputComponent(opening.name, context)) {
      return false;
    }
    attachments += 1;
  }
  if (attachments !== 1) return false;

  // The active option can blur while the input is focused. Preserve visible
  // handlers throughout this component, including JSX produced by local helpers.
  let containsFocusObserver = false;
  walkAst(component, (child) => {
    if (containsFocusObserver) return false;
    if (
      isNodeOfType(child, "JSXSpreadAttribute") ||
      (isNodeOfType(child, "JSXAttribute") &&
        FOCUS_PROP_PATTERN.test(getJsxAttributeName(child.name) ?? ""))
    ) {
      containsFocusObserver = true;
      return false;
    }
  });
  return !containsFocusObserver;
};

// Classify the one setter a closed helper contributes, as if the helper body
// were inlined. Focusing the ref can synchronously dispatch browser events.
const isGuardedLocalFocusAndSelfReset = (
  outerCall: EsTreeNode,
  outerRef: Reference,
  effectFunction: EsTreeNode,
  deps: Reference[],
  analysis: ProgramAnalysis,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(outerCall, "CallExpression") ||
    outerCall.optional ||
    outerCall.arguments.length !== 0 ||
    !isNodeOfType(outerCall.callee, "Identifier") ||
    deps.length !== 1
  ) {
    return false;
  }
  const component = findEnclosingFunction(effectFunction);
  const helperSymbol = context.scopes.symbolFor(outerCall.callee);
  const helper = helperSymbol?.initializer;
  if (
    helperSymbol?.kind !== "const" ||
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.params.length !== 0 ||
    !isNodeOfType(helper.body, "BlockStatement") ||
    helper.body.body.length !== 2 ||
    !component ||
    findEnclosingFunction(helper) !== component
  ) {
    return false;
  }
  const [declaration, branch] = helper.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    !isNodeOfType(branch.consequent, "BlockStatement") ||
    branch.consequent.body.length !== 2
  ) {
    return false;
  }
  const [input] = declaration.declarations;
  if (
    !isNodeOfType(input.id, "Identifier") ||
    !isNodeOfType(input.init, "MemberExpression") ||
    input.init.computed ||
    input.init.optional ||
    !isNodeOfType(input.init.object, "Identifier") ||
    getStaticPropertyName(input.init) !== "current" ||
    !isNodeOfType(branch.test, "Identifier")
  ) {
    return false;
  }
  const inputSymbol = context.scopes.symbolFor(input.id);
  const inputRef = context.scopes.symbolFor(input.init.object);
  const refInitializer = inputRef?.initializer;
  if (
    !inputSymbol ||
    context.scopes.symbolFor(branch.test) !== inputSymbol ||
    !isNodeOfType(refInitializer, "CallExpression") ||
    !isReactApiCall(refInitializer, "useRef", context.scopes) ||
    refInitializer.arguments.length !== 1 ||
    !isNodeOfType(refInitializer.arguments[0], "Literal") ||
    refInitializer.arguments[0].value !== null ||
    inputRef?.kind !== "const" ||
    !hasClosedFocusRefWiring(inputRef, input.init, component, context)
  ) {
    return false;
  }
  const [focusStatement, resetStatement] = branch.consequent.body;
  if (
    !isNodeOfType(focusStatement, "ExpressionStatement") ||
    !isNodeOfType(resetStatement, "ExpressionStatement")
  ) {
    return false;
  }
  const focus = focusStatement.expression;
  const reset = resetStatement.expression;
  if (
    !isNodeOfType(focus, "CallExpression") ||
    focus.optional ||
    focus.arguments.length !== 0 ||
    !isNodeOfType(focus.callee, "MemberExpression") ||
    focus.callee.computed ||
    focus.callee.optional ||
    getStaticPropertyName(focus.callee) !== "focus" ||
    !isNodeOfType(focus.callee.object, "Identifier") ||
    context.scopes.symbolFor(focus.callee.object) !== inputSymbol ||
    !isNodeOfType(reset, "CallExpression") ||
    reset.optional ||
    reset.arguments.length !== 1 ||
    !isNodeOfType(reset.callee, "Identifier")
  ) {
    return false;
  }
  const resetRef = getRef(analysis, reset.callee);
  const setter = resetRef && resolveStateSetterReference(analysis, resetRef);
  const state = deps[0];
  const stateDeclarator = getUseStateDeclarator(state);
  if (
    !setter ||
    !state.resolved ||
    !stateDeclarator ||
    getUseStateDeclarator(setter) !== stateDeclarator
  ) {
    return false;
  }
  const setterCalls = getEventualCallRefsTo(
    analysis,
    outerRef,
    (candidate) => resolveStateSetterReference(analysis, candidate) !== null,
  );
  if (setterCalls.length !== 1 || getCallExpr(setterCalls[0]) !== reset) return false;
  const sentinel = getNumericSentinel(reset.arguments[0], context);
  return (
    sentinel !== null &&
    hasSameStateSentinelGuard(outerCall, state, sentinel, analysis, context, effectFunction)
  );
};

export const noChainStateUpdates = defineRule({
  id: "no-chain-state-updates",
  title: "State updates chained through effects",
  severity: "warn",
  disabledWhen: ["react:18"],
  tags: ["test-noise"],
  recommendation:
    "Set all the related state together in the event handler that starts it, instead of having one useEffect react to a state change and set more state. See https://react.dev/learn/you-might-not-need-an-effect#chains-of-computations",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isReactApiCall(node, APPLICABLE_EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveConditionalAliases: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const stateDeps = depsRefs.flatMap((reference) => {
        const upstreamState = getDependencyStateRefs(analysis, context, reference);
        if (
          upstreamState.length > 0 &&
          isStableProjectedEffectDependency(
            reference.identifier as unknown as EsTreeNode,
            node,
            context.scopes,
          )
        ) {
          return [];
        }
        return upstreamState;
      });
      if (stateDeps.length === 0) return;
      // Every triggering state dep is driven by a timer / listener / observer
      // / subscription — there is no single event handler to set all the
      // related state together, so the chain is the correct shape here.
      if (stateDeps.every((ref) => isExternallyDrivenState(analysis, ref))) return;

      const stateDepDeclarators = new Set(
        stateDeps
          .map((ref) => getUseStateDeclarator(ref))
          .filter((declarator): declarator is EsTreeNode => declarator !== null),
      );
      const isReachableFromStateTrigger = createStateTriggerReachability({
        analysis,
        context,
        effectFunction: effectFn,
      });

      // A state synced from a live DOM read (`document.querySelectorAll`,
      // a layout measurement) cannot be computed in the upstream event
      // handler — the DOM is only consistent after commit, so the effect is
      // required and the doc's "set both in the handler" fix cannot apply.
      // The whole state is exempt, including its fallback resets in the same
      // effect (the `catch { setAnchors([]) }` arm of the DOM-sync flow).
      const domSyncedStateDeclarators = new Set<EsTreeNode>();
      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        if (!isReachableFromStateTrigger(callExpr)) continue;
        if (
          !readsPostMountValueThroughLocals(callExpr, effectFn, {
            ignoreBareRefCurrent: true,
            scopes: context.scopes,
          })
        ) {
          continue;
        }
        const declarator = getUseStateDeclarator(resolveStateSetterReference(analysis, ref) ?? ref);
        if (declarator) domSyncedStateDeclarators.add(declarator);
      }

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        if (!isReachableFromStateTrigger(callExpr)) continue;
        // Avoid overlap with no-derived-state
        const isSomeArgsState = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isState(analysis, argRef),
        );
        if (isSomeArgsState) continue;
        // Guarded self-sync: the setter writes the SAME state the effect
        // depends on (clamp/normalize/latch patterns — `setPage(max)` when
        // `page` is a dep). These converge in one pass and re-derive from
        // in-scope values, so there is no handler to hoist them into. Only
        // simple re-derivations are exempt; a self-targeting setter fed by
        // a call result (editor/instance creation) is still a chain.
        const setterDeclarator = getUseStateDeclarator(
          resolveStateSetterReference(analysis, ref) ?? ref,
        );
        if (setterDeclarator && domSyncedStateDeclarators.has(setterDeclarator)) continue;
        const isSelfTargeting =
          setterDeclarator !== null && stateDepDeclarators.has(setterDeclarator);
        const setterArguments = isNodeOfType(callExpr, "CallExpression")
          ? ((callExpr.arguments ?? []) as EsTreeNode[])
          : [];
        if (
          isSelfTargeting &&
          setterArguments.every((argument) =>
            isSimpleExpression(analysis, argument, effectFn, new WeakSet()),
          )
        ) {
          continue;
        }
        if (
          isGuardedLocalFocusAndSelfReset(callExpr, ref, effectFn, stateDeps, analysis, context)
        ) {
          continue;
        }
        context.report({
          node: callExpr,
          message: "Chaining state updates triggers an extra render each step.",
        });
      }
    },
  }),
});
