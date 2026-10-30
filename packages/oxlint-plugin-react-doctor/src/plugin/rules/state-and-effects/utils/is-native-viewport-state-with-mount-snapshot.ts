import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { collectLocalValueReferences } from "../../../utils/collect-local-value-references.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../../utils/unwrap-discarded-expression.js";
import { unwrapReturnExpression } from "../../../utils/unwrap-return-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ViewportAliasReferences {
  symbols: Set<SymbolDescriptor>;
  references: Set<EsTreeNode>;
}

const providerFactsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const stateFactsByAnalysis = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
const readonlySymbols = new WeakMap<SymbolDescriptor, boolean>();
const VIEWPORT_FIELDS = new Set(["innerWidth", "innerHeight"]);
const VIEWPORT_MEMBERS = new Set([
  "innerWidth",
  "innerHeight",
  "addEventListener",
  "removeEventListener",
]);
const REFLECTIVE_KEYS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "assign",
  "call",
  "apply",
  "bind",
]);
const UNSUPPORTED_GLOBALS = new Set([
  "globalThis",
  "global",
  "self",
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Object",
  "require",
]);
const UNSUPPORTED_RUNTIME_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

const isReadonly = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlySymbols.get(symbol);
  if (cached !== undefined) return cached;
  const result = symbol.references.every((reference) => reference.flag === "read");
  readonlySymbols.set(symbol, result);
  return result;
};

const isRuntimeReactCall = (
  expression: EsTreeNode,
  importedName: string,
  context: RuleContext,
): expression is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === importedName &&
    isReadonly(symbol),
  );
};

const isComputedValueUsedOnlyAsData = (member: EsTreeNode, context: RuleContext): boolean => {
  const pending = collectLocalValueReferences(member, context);
  const visited = new Set<EsTreeNode>();
  while (pending.length > 0) {
    const reference = pending.pop();
    if (!reference || visited.has(reference)) continue;
    visited.add(reference);
    let value = findTransparentExpressionRoot(reference);
    while (true) {
      const parent = value.parent;
      if (!parent) return false;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === value &&
        isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const"
      ) {
        const alias = context.scopes.symbolFor(parent.id);
        if (!alias || !isReadonly(alias)) return false;
        pending.push(
          ...collectLocalValueReferences(value, context).filter((node) => node !== value),
        );
        break;
      }
      if (
        (isNodeOfType(parent, "UnaryExpression") && parent.operator !== "delete") ||
        (isNodeOfType(parent, "BinaryExpression") &&
          parent.operator !== "in" &&
          parent.operator !== "instanceof") ||
        (isNodeOfType(parent, "TemplateLiteral") &&
          !isNodeOfType(parent.parent, "TaggedTemplateExpression")) ||
        isNodeOfType(parent, "ExpressionStatement")
      )
        break;
      if (
        (isNodeOfType(parent, "IfStatement") ||
          isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ForStatement")) &&
        parent.test === value
      )
        break;
      if (isNodeOfType(parent, "ConditionalExpression") && parent.test === value) break;
      if (
        isNodeOfType(parent, "LogicalExpression") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        (isNodeOfType(parent, "MemberExpression") &&
          parent.object === value &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          parent.property.name === "length" &&
          !isWithinAssignmentTarget(parent))
      ) {
        value = findTransparentExpressionRoot(parent);
        continue;
      }
      if (
        isNodeOfType(parent, "JSXExpressionContainer") &&
        isNodeOfType(parent.parent, "JSXElement") &&
        isNodeOfType(parent.parent.openingElement.name, "JSXIdentifier") &&
        /^[a-z]/.test(parent.parent.openingElement.name.name)
      )
        break;
      return false;
    }
  }
  return true;
};

const hasClosedProviders = (node: EsTreeNode, context: RuleContext): boolean => {
  const cached = providerFactsByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  const program = findProgramRoot(node);
  let valid = Boolean(program);
  if (program)
    walkAst(program, (child) => {
      if (!valid) return false;
      if (UNSUPPORTED_RUNTIME_TYPES.has(child.type)) {
        valid = false;
        return false;
      }
      if (isTypeScriptTypePosition(child)) return false;
      if (isNodeOfType(child, "WithStatement") || isNodeOfType(child, "ImportExpression")) {
        valid = false;
        return false;
      }
      if (isNodeOfType(child, "MemberExpression")) {
        const wrappedKey = child.computed ? stripParenExpression(child.property) : null;
        const property =
          getResolvedStaticPropertyName(child, context.scopes, {
            allowConstNumericLiteral: true,
            allowConstTemplateLiteral: true,
            stringifyNonStringLiterals: true,
          }) ?? (isNodeOfType(wrappedKey, "Literal") ? String(wrappedKey.value) : null);
        if (
          (property && REFLECTIVE_KEYS.has(property)) ||
          (isWithinAssignmentTarget(child) &&
            (!property ||
              VIEWPORT_MEMBERS.has(property) ||
              isProvenGlobalNamespaceReference(child.object, "window", context.scopes))) ||
          (child.computed && !property && !isComputedValueUsedOnlyAsData(child, context))
        ) {
          valid = false;
          return false;
        }
      }
      if (isNodeOfType(child, "Property") && isNodeOfType(child.parent, "ObjectPattern")) {
        const property = getStaticPropertyKeyName(child, { allowComputedString: true });
        if (
          !property ||
          REFLECTIVE_KEYS.has(property) ||
          VIEWPORT_MEMBERS.has(property) ||
          UNSUPPORTED_GLOBALS.has(property) ||
          property === "window"
        ) {
          valid = false;
          return false;
        }
      }
      if (!isNodeOfType(child, "Identifier") || !context.scopes.referenceFor(child)) return;
      if (context.scopes.isGlobalReference(child)) {
        if (UNSUPPORTED_GLOBALS.has(child.name)) {
          valid = false;
          return false;
        }
        if (child.name === "window") {
          const root = findTransparentExpressionRoot(child);
          const member = root.parent;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== root ||
            member.computed ||
            member.optional ||
            !isNodeOfType(member.property, "Identifier") ||
            !VIEWPORT_MEMBERS.has(member.property.name)
          ) {
            valid = false;
            return false;
          }
          if (!VIEWPORT_FIELDS.has(member.property.name)) {
            const memberRoot = findTransparentExpressionRoot(member);
            const call = memberRoot.parent;
            if (
              !isNodeOfType(call, "CallExpression") ||
              call.callee !== memberRoot ||
              call.optional
            ) {
              valid = false;
              return false;
            }
          }
        }
      }
      const symbol = context.scopes.symbolFor(child);
      if (symbol?.kind === "import" && getValueImportSource(symbol) === "react") {
        const root = findTransparentExpressionRoot(child);
        if (
          !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
          !isReadonly(symbol) ||
          !isNodeOfType(root.parent, "CallExpression") ||
          root.parent.callee !== root ||
          root.parent.optional
        ) {
          valid = false;
          return false;
        }
      }
    });
  providerFactsByAnalysis.set(context.scopes, valid);
  return valid;
};

const isPlainCallback = (node: EsTreeNode): boolean =>
  isFunctionLike(node) &&
  !node.async &&
  !node.generator &&
  node.params.length === 0 &&
  !(isNodeOfType(node, "FunctionExpression") && node.id);

const getMountCall = (callback: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isPlainCallback(callback)) return null;
  let hook = findTransparentExpressionRoot(callback).parent;
  if (isNodeOfType(hook, "VariableDeclarator") && isNodeOfType(hook.id, "Identifier")) {
    const symbol = context.scopes.symbolFor(hook.id);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isReadonly(symbol) ||
      !symbol.initializer ||
      stripParenExpression(symbol.initializer) !== callback ||
      !hook.init ||
      stripParenExpression(hook.init) !== callback ||
      symbol.references.length !== 1 ||
      !isNodeOfType(hook.parent, "VariableDeclaration") ||
      hook.parent.declarations.length !== 1
    )
      return null;
    const reference = findTransparentExpressionRoot(symbol.references[0].identifier);
    hook = reference.parent;
    if (!isNodeOfType(hook, "CallExpression") || hook.arguments[0] !== reference) return null;
    if (
      symbol.declarationNode.range[1] >= reference.range[0] ||
      !nodeDominatesNode(symbol.declarationNode, hook, context)
    )
      return null;
  }
  if (
    !hook ||
    !isRuntimeReactCall(hook, "useEffect", context) ||
    getEffectCallback(hook, context.scopes) !== callback ||
    hook.arguments.length !== 2 ||
    !isNodeOfType(hook.arguments[1], "ArrayExpression") ||
    hook.arguments[1].elements.length !== 0
  )
    return null;
  return hook;
};

const getNativeDimension = (
  expression: EsTreeNode,
  owner: EsTreeNode,
  aliases: ViewportAliasReferences,
  context: RuleContext,
  visited: Set<SymbolDescriptor> = new Set(),
): string | null => {
  const value = stripParenExpression(expression);
  const receiver = isNodeOfType(value, "MemberExpression")
    ? stripParenExpression(value.object)
    : null;
  if (
    isNodeOfType(value, "MemberExpression") &&
    !value.computed &&
    !value.optional &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(value.property, "Identifier") &&
    VIEWPORT_FIELDS.has(value.property.name) &&
    isProvenUnmodifiedGlobalNamespaceReference(receiver, "window", context.scopes)
  ) {
    return value.property.name;
  }
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(value);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isReadonly(symbol) ||
    visited.has(symbol) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !symbol.initializer ||
    symbol.declarationNode.range[0] >= value.range[0] ||
    findEnclosingFunction(symbol.bindingIdentifier) !== owner
  )
    return null;
  aliases.symbols.add(symbol);
  aliases.references.add(value);
  return getNativeDimension(
    symbol.initializer,
    owner,
    aliases,
    context,
    new Set([...visited, symbol]),
  );
};

const getMeasurement = (
  expression: EsTreeNode,
  owner: EsTreeNode,
  aliases: ViewportAliasReferences,
  context: RuleContext,
): string | null => {
  const value = stripParenExpression(expression);
  if (!isNodeOfType(value, "ObjectExpression"))
    return getNativeDimension(value, owner, aliases, context);
  if (value.properties.length !== 2) return null;
  const fields = new Set<string>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (
      (key !== "width" && key !== "height") ||
      fields.has(key) ||
      getNativeDimension(property.value, owner, aliases, context) !==
        (key === "width" ? "innerWidth" : "innerHeight")
    )
      return null;
    if (
      property.shorthand &&
      isNodeOfType(property.key, "Identifier") &&
      isNodeOfType(property.value, "Identifier") &&
      context.scopes.symbolFor(property.key) === context.scopes.symbolFor(property.value)
    ) {
      aliases.references.add(property.key);
    }
    fields.add(key);
  }
  return "width:innerWidth;height:innerHeight";
};

const hasOnlyMeasurementDeclarations = (
  statements: EsTreeNode[],
  aliases: ViewportAliasReferences,
  context: RuleContext,
): boolean =>
  statements.every(
    (statement) =>
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.every((declaration) => {
        if (!isNodeOfType(declaration.id, "Identifier")) return false;
        const symbol = context.scopes.symbolFor(declaration.id);
        return Boolean(symbol && aliases.symbols.has(symbol));
      }),
  ) &&
  [...aliases.symbols].every((symbol) =>
    symbol.references.every(
      (reference) => reference.flag === "read" && aliases.references.has(reference.identifier),
    ),
  );

const getListenerHandler = (
  statement: EsTreeNode,
  method: string,
  context: RuleContext,
): EsTreeNodeOfType<"Identifier"> | null => {
  const call = unwrapDiscardedExpression(statement);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 2 ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== "resize" ||
    !isNodeOfType(call.arguments[1], "Identifier")
  )
    return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== method
  )
    return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "window" ||
    !context.scopes.isGlobalReference(receiver)
  )
    return null;
  return call.arguments[1];
};

const isReadonlyRecordState = (symbol: SymbolDescriptor, context: RuleContext): boolean =>
  isReadonly(symbol) &&
  symbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const consumer = root.parent;
    if (
      isNodeOfType(consumer, "MemberExpression") &&
      consumer.object === root &&
      !consumer.computed &&
      isNodeOfType(consumer.property, "Identifier") &&
      (consumer.property.name === "width" || consumer.property.name === "height")
    ) {
      return !isWithinAssignmentTarget(consumer);
    }
    const call = consumer?.parent;
    return (
      isNodeOfType(consumer, "ArrayExpression") &&
      consumer.elements.some((element) => element === root) &&
      call &&
      (isRuntimeReactCall(call, "useMemo", context) ||
        isRuntimeReactCall(call, "useEffect", context)) &&
      call.arguments[1] === consumer
    );
  });

const hasClosedPlaceholder = (expression: EsTreeNode, record: boolean): boolean => {
  const value = stripParenExpression(expression);
  if (!record)
    return (
      isNodeOfType(value, "Literal") &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)
    );
  if (!isNodeOfType(value, "ObjectExpression") || value.properties.length !== 2) return false;
  const fields = new Set<string>();
  return value.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if ((key !== "width" && key !== "height") || fields.has(key)) return false;
    fields.add(key);
    return (
      isNodeOfType(property.value, "Literal") &&
      typeof property.value.value === "number" &&
      Number.isFinite(property.value.value)
    );
  });
};

const hasClosedMountAndSampler = (
  snapshot: EsTreeNodeOfType<"CallExpression">,
  sampled: EsTreeNodeOfType<"CallExpression">,
  state: SymbolDescriptor,
  setter: SymbolDescriptor,
  initializer: EsTreeNode,
  context: RuleContext,
): boolean => {
  const effect = findEnclosingFunction(snapshot);
  const sampler = findEnclosingFunction(sampled);
  if (!effect || !sampler || !isPlainCallback(sampler)) return false;
  const mount = getMountCall(effect, context);
  const samplerDeclarator = sampler.parent;
  const component = mount ? findEnclosingFunction(mount) : null;
  if (
    !mount ||
    !isFunctionLike(component) ||
    !isNodeOfType(component.body, "BlockStatement") ||
    findEnclosingFunction(state.declarationNode) !== component ||
    !isNodeOfType(samplerDeclarator, "VariableDeclarator") ||
    samplerDeclarator.init !== sampler ||
    !isNodeOfType(samplerDeclarator.id, "Identifier") ||
    !isNodeOfType(samplerDeclarator.parent, "VariableDeclaration") ||
    samplerDeclarator.parent.kind !== "const" ||
    samplerDeclarator.parent.declarations.length !== 1 ||
    samplerDeclarator.parent.parent !== component.body ||
    samplerDeclarator.range[0] >= mount.range[0]
  )
    return false;
  let mountStatement = mount;
  while (mountStatement.parent && mountStatement.parent !== component.body) {
    mountStatement = mountStatement.parent;
  }
  if (
    !isNodeOfType(mountStatement, "ExpressionStatement") ||
    unwrapDiscardedExpression(mountStatement) !== mount
  )
    return false;
  const samplerSymbol = context.scopes.symbolFor(samplerDeclarator.id);
  if (!samplerSymbol || !isReadonly(samplerSymbol) || samplerSymbol.references.length !== 2)
    return false;
  const setup = getCallbackStatements(effect);
  const samplerBody = getCallbackStatements(sampler);
  if (
    setup.length < 3 ||
    samplerBody.length === 0 ||
    unwrapDiscardedExpression(setup[setup.length - 2]) !== snapshot ||
    unwrapDiscardedExpression(unwrapReturnExpression(samplerBody[samplerBody.length - 1])) !==
      sampled
  )
    return false;
  const registered = getListenerHandler(setup[0], "addEventListener", context);
  const returned = setup[setup.length - 1];
  if (
    !registered ||
    context.scopes.symbolFor(registered) !== samplerSymbol ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument ||
    !isPlainCallback(returned.argument)
  )
    return false;
  const cleanup = getCallbackStatements(returned.argument);
  if (cleanup.length === 0) return false;
  const removed = getListenerHandler(cleanup[0], "removeEventListener", context);
  if (
    !removed ||
    context.scopes.symbolFor(removed) !== samplerSymbol ||
    !samplerSymbol.references.every(
      (reference) => reference.identifier === registered || reference.identifier === removed,
    )
  )
    return false;
  let closedSuffix = true;
  for (const statement of cleanup.slice(1))
    walkAst(statement, (node) => {
      if (!closedSuffix) return false;
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "Identifier")) {
        const symbol = context.scopes.symbolFor(node);
        if (
          symbol === state ||
          symbol === setter ||
          symbol === samplerSymbol ||
          isProvenGlobalNamespaceReference(node, "window", context.scopes)
        )
          closedSuffix = false;
      }
    });
  if (!closedSuffix) return false;
  const snapshotAliases: ViewportAliasReferences = { symbols: new Set(), references: new Set() };
  const samplerAliases: ViewportAliasReferences = { symbols: new Set(), references: new Set() };
  const measurement = getMeasurement(snapshot.arguments[0], effect, snapshotAliases, context);
  if (
    !measurement ||
    getMeasurement(sampled.arguments[0], sampler, samplerAliases, context) !== measurement ||
    !hasClosedPlaceholder(initializer, measurement.includes(":")) ||
    (measurement.includes(":") && !isReadonlyRecordState(state, context))
  )
    return false;
  return (
    hasOnlyMeasurementDeclarations(setup.slice(1, -2), snapshotAliases, context) &&
    hasOnlyMeasurementDeclarations(samplerBody.slice(0, -1), samplerAliases, context)
  );
};

const computeNativeViewportState = (declaration: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    !isNodeOfType(declaration.id.elements[1], "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const pair = resolveReactUseStatePair(declaration.id.elements[1], context.scopes);
  if (
    !pair?.stateSymbol ||
    pair.declarator !== declaration ||
    !isReadonly(pair.setterSymbol) ||
    !isReadonly(pair.stateSymbol) ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isRuntimeReactCall(declaration.init, "useState", context) ||
    declaration.init.arguments.length !== 1 ||
    !hasClosedProviders(declaration, context) ||
    pair.setterSymbol.references.length !== 2
  )
    return false;
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const reference of pair.setterSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== 1
    )
      return false;
    calls.push(call);
  }
  return (
    hasClosedMountAndSampler(
      calls[0],
      calls[1],
      pair.stateSymbol,
      pair.setterSymbol,
      declaration.init.arguments[0],
      context,
    ) ||
    hasClosedMountAndSampler(
      calls[1],
      calls[0],
      pair.stateSymbol,
      pair.setterSymbol,
      declaration.init.arguments[0],
      context,
    )
  );
};

export const isNativeViewportStateWithMountSnapshot = (
  declaration: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!declaration) return false;
  const states = stateFactsByAnalysis.get(context.scopes) ?? new WeakMap<EsTreeNode, boolean>();
  stateFactsByAnalysis.set(context.scopes, states);
  const cached = states.get(declaration);
  if (cached !== undefined) return cached;
  const result = computeNativeViewportState(declaration, context);
  states.set(declaration, result);
  return result;
};
