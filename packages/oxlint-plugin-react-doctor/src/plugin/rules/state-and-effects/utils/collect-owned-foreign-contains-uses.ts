import { isEventHandlerName } from "./event-handler-reference.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OWNED_INPUT_EMPTY_COUNT,
  OWNED_INPUT_SINGLE_COUNT,
  OWNED_INPUT_PAIR_COUNT,
  OWNED_INPUT_MAX_RESOLUTION_DEPTH,
  OWNED_INPUT_RESERVED_ATTRIBUTES,
} from "./constants.js";

export interface OwnedForeignContainsUsesInput {
  readonly module: SourceProjectModule;
  readonly index: SourceProjectIndex;
  readonly resolveHostName: (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: SourceProjectModule,
  ) => string | null;
}

interface ForeignContainsRest {
  readonly symbol: SymbolDescriptor;
  readonly owner: EsTreeNode;
  readonly consumed: ReadonlySet<string>;
}

interface ForeignContainsBinding {
  readonly symbol: SymbolDescriptor;
  readonly module: SourceProjectModule;
}

interface ForeignContainsFunction {
  readonly callback: EsTreeNode;
  readonly module: SourceProjectModule;
  readonly bindings: ReadonlyArray<ForeignContainsBinding>;
}

const isRuntimeRead = (node: EsTreeNode): boolean =>
  !isNonReferenceIdentifier(node) && !isTypeScriptTypePosition(node);

const isReadonly = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean =>
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes);

const isBooleanUse = (rawValue: EsTreeNode): boolean => {
  const value = findTransparentExpressionRoot(rawValue);
  const parent = value.parent;
  if (
    (isNodeOfType(parent, "UnaryExpression") &&
      (parent.operator === "!" || parent.operator === "typeof")) ||
    (isNodeOfType(parent, "BinaryExpression") &&
      (parent.operator === "===" || parent.operator === "!=="))
  )
    return true;
  if (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
    parent.test === value
  )
    return true;
  return isNodeOfType(parent, "LogicalExpression") && isBooleanUse(parent);
};

const readRestPattern = (
  rawPattern: EsTreeNode | undefined,
  owner: EsTreeNode,
  module: SourceProjectModule,
): ForeignContainsRest | null => {
  if (!rawPattern) return null;
  const pattern = stripParenExpression(rawPattern);
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  const last = pattern.properties.at(-OWNED_INPUT_SINGLE_COUNT);
  if (!isNodeOfType(last, "RestElement") || !isNodeOfType(last.argument, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(last.argument);
  if (!symbol || !isReadonly(symbol, module)) return null;
  const consumed = new Set<string>();
  for (const property of pattern.properties.slice(
    OWNED_INPUT_EMPTY_COUNT,
    -OWNED_INPUT_SINGLE_COUNT,
  )) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    const binding = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    if (!name || name === "__proto__" || !isNodeOfType(binding, "Identifier")) return null;
    consumed.add(name);
  }
  return { symbol, owner, consumed };
};

const readOwnParameterRest = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): ForeignContainsRest | null => {
  const owner = findEnclosingFunction(symbol.declarationNode);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== OWNED_INPUT_SINGLE_COUNT
  )
    return null;
  const parameter = owner.params[OWNED_INPUT_EMPTY_COUNT];
  const direct = readRestPattern(parameter, owner, module);
  if (direct?.symbol === symbol) return direct;
  if (!isNodeOfType(parameter, "Identifier")) return null;
  const source = module.scopes.symbolFor(parameter);
  const declaration = symbol.declarationNode;
  if (
    !source ||
    !isReadonly(source, module) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !declaration.init ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    module.scopes.symbolFor(stripParenExpression(declaration.init)) !== source
  )
    return null;
  const sourceUse = declaration.init;
  const rest = readRestPattern(declaration.id, owner, module);
  return rest?.symbol === symbol &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.kind === "const" &&
    source.references.every(
      (reference) =>
        !isRuntimeRead(reference.identifier) ||
        findTransparentExpressionRoot(reference.identifier) ===
          findTransparentExpressionRoot(sourceUse),
    )
    ? rest
    : null;
};

const resolveOwnFunction = (
  rawValue: EsTreeNode,
  module: SourceProjectModule,
  index: SourceProjectIndex,
  seen = new Set<SymbolDescriptor>(),
  depth = OWNED_INPUT_EMPTY_COUNT,
): ForeignContainsFunction | null => {
  if (depth > OWNED_INPUT_MAX_RESOLUTION_DEPTH) return null;
  const value = stripParenExpression(rawValue);
  if (isFunctionLike(value)) return { callback: value, module, bindings: [] };
  if (!isNodeOfType(value, "Identifier") && !isNodeOfType(value, "JSXIdentifier")) return null;
  const symbol = module.scopes.symbolFor(value);
  if (!symbol || seen.has(symbol) || !isReadonly(symbol, module)) return null;
  const nextSeen = new Set(seen).add(symbol);
  const imported = getValueImportDeclaration(symbol);
  if (imported && isNodeOfType(imported, "ImportDeclaration")) {
    if (!imported.source.value.startsWith(".")) return null;
    const name = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
      ? "default"
      : getImportedName(symbol.declarationNode);
    const exported = name
      ? resolveCrossFileValueExportWithFilePath(module.filePath, imported.source.value, name, {
          requireCompleteReexports: true,
        })
      : null;
    const target = exported ? index.modulesByFilePath.get(exported.filePath) : undefined;
    if (!exported || !target || target.programNode !== exported.programNode) return null;
    const root = findTransparentExpressionRoot(exported.exportedNode);
    const parent = root.parent;
    const identifier =
      isNodeOfType(exported.exportedNode, "FunctionDeclaration") && exported.exportedNode.id
        ? exported.exportedNode.id
        : isNodeOfType(parent, "VariableDeclarator") &&
            parent.init === root &&
            isNodeOfType(parent.id, "Identifier")
          ? parent.id
          : exported.exportedNode;
    const result = resolveOwnFunction(
      identifier,
      target,
      index,
      nextSeen,
      depth + OWNED_INPUT_SINGLE_COUNT,
    );
    return result ? { ...result, bindings: [...result.bindings, { symbol, module }] } : null;
  }
  const initial =
    symbol.kind === "function" ? symbol.declarationNode : getDirectUnreassignedInitializer(symbol);
  const result = initial
    ? resolveOwnFunction(initial, module, index, nextSeen, depth + OWNED_INPUT_SINGLE_COUNT)
    : null;
  return result ? { ...result, bindings: [...result.bindings, { symbol, module }] } : null;
};

const isGlobalListener = (
  rawCall: EsTreeNode,
  callbackUse: EsTreeNode,
  module: SourceProjectModule,
): boolean => {
  const call = stripParenExpression(rawCall);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length < OWNED_INPUT_PAIR_COUNT ||
    call.arguments.length > OWNED_INPUT_PAIR_COUNT + OWNED_INPUT_SINGLE_COUNT ||
    call.arguments[OWNED_INPUT_SINGLE_COUNT] !== callbackUse
  )
    return false;
  const callee = stripParenExpression(call.callee);
  const eventName = call.arguments[OWNED_INPUT_EMPTY_COUNT];
  const capture = call.arguments[OWNED_INPUT_PAIR_COUNT];
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    !["addEventListener", "removeEventListener"].includes(getStaticPropertyName(callee) ?? "") ||
    !isNodeOfType(eventName, "Literal") ||
    typeof eventName.value !== "string" ||
    (capture && (!isNodeOfType(capture, "Literal") || typeof capture.value !== "boolean"))
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    ["window", "document"].includes(receiver.name) &&
    module.scopes.isGlobalReference(receiver)
  );
};

export const collectOwnedForeignContainsUses = ({
  module,
  index,
  resolveHostName,
}: OwnedForeignContainsUsesInput): ReadonlySet<EsTreeNode> => {
  const approvedArguments = new Set<EsTreeNode>();
  if (hasReactDefaultProviderMutation("useRef", module.scopes)) return approvedArguments;
  const isPoisonKey = (name: string, consumed: ReadonlySet<string>): boolean =>
    !consumed.has(name) && (OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) || isEventHandlerName(name));
  const validateCallerFrontier = (
    owner: EsTreeNode,
    ownerModule: SourceProjectModule,
    inheritedConsumed: ReadonlySet<string>,
    visited = new Set<EsTreeNode>(),
  ): boolean => {
    if (
      !isFunctionLike(owner) ||
      owner.async ||
      owner.generator ||
      visited.has(owner) ||
      visited.size > OWNED_INPUT_MAX_RESOLUTION_DEPTH
    )
      return false;
    const consumed = new Set(inheritedConsumed);
    const nextVisited = new Set(visited).add(owner);
    if (owner.params.length !== OWNED_INPUT_SINGLE_COUNT) return false;
    const parameter = owner.params[OWNED_INPUT_EMPTY_COUNT];
    const pattern = readRestPattern(parameter, owner, ownerModule);
    if (pattern) for (const name of pattern.consumed) consumed.add(name);
    else if (!isNodeOfType(parameter, "Identifier")) return false;
    let hasForeignReceiver = false;
    walkAst(owner, (node) => {
      if (
        isNodeOfType(node, "ThisExpression") ||
        isNodeOfType(node, "Super") ||
        isNodeOfType(node, "MetaProperty") ||
        (isNodeOfType(node, "Identifier") &&
          isRuntimeRead(node) &&
          (node.name === "arguments" ||
            (node.name === "event" && ownerModule.scopes.isGlobalReference(node))))
      )
        hasForeignReceiver = true;
    });
    if (hasForeignReceiver) return false;
    const roots = getFunctionBindingSymbols(owner, ownerModule.scopes);
    if (!roots.length) return false;
    const bindings = new Map<SymbolDescriptor, SourceProjectModule>(
      roots.map((symbol) => [symbol, ownerModule]),
    );
    const reachesOwner = (
      candidate: SourceProjectModule,
      seen = new Set<SourceProjectModule>(),
    ): boolean => {
      if (candidate === ownerModule) return true;
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      let found = false;
      walkAst(candidate.programNode, (node) => {
        const filePath = index.resolvedSourcePathByNode.get(node);
        const dependency = filePath ? index.modulesByFilePath.get(filePath) : undefined;
        if (dependency && reachesOwner(dependency, new Set(seen))) found = true;
      });
      return found;
    };
    for (const candidate of index.modulesByFilePath.values()) {
      for (const statement of candidate.programNode.body) {
        if (
          !isNodeOfType(statement, "ImportDeclaration") ||
          statement.importKind === "type" ||
          !statement.source.value.startsWith(".")
        )
          continue;
        for (const specifier of statement.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            const targetPath = index.resolvedSourcePathByNode.get(statement);
            const target = targetPath ? index.modulesByFilePath.get(targetPath) : undefined;
            if (target && reachesOwner(target)) return false;
            continue;
          }
          const result = resolveOwnFunction(specifier.local, candidate, index);
          if (result?.callback === owner)
            for (const binding of result.bindings) bindings.set(binding.symbol, binding.module);
        }
      }
    }
    const areClosedProducerReferences = (
      symbol: SymbolDescriptor,
      sourceModule: SourceProjectModule,
      sourceUse: EsTreeNode,
      seen = new Set<SymbolDescriptor>(),
    ): boolean => {
      if (seen.has(symbol)) return true;
      if (!isReadonly(symbol, sourceModule)) return false;
      const nextSeen = new Set(seen).add(symbol);
      return symbol.references.every((reference) => {
        if (!isRuntimeRead(reference.identifier)) return true;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          (isNodeOfType(parent, "JSXSpreadAttribute") && parent.argument === root) ||
          (isNodeOfType(parent, "SpreadElement") &&
            parent.argument === root &&
            isNodeOfType(parent.parent, "ObjectExpression"))
        )
          return true;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = sourceModule.scopes.symbolFor(parent.id);
          return Boolean(
            alias && areClosedProducerReferences(alias, sourceModule, sourceUse, nextSeen),
          );
        }
        return root === findTransparentExpressionRoot(sourceUse);
      });
    };
    const validateProps = (
      rawValue: EsTreeNode,
      sourceModule: SourceProjectModule,
      sourceUse: EsTreeNode,
      seen = new Set<SymbolDescriptor>(),
    ): boolean => {
      const value = stripParenExpression(rawValue);
      if (isNodeOfType(value, "ObjectExpression"))
        return value.properties.every((property) => {
          if (isNodeOfType(property, "SpreadElement"))
            return validateProps(property.argument, sourceModule, property.argument, new Set(seen));
          if (
            !isNodeOfType(property, "Property") ||
            property.computed ||
            property.method ||
            property.kind !== "init"
          )
            return false;
          const name = getStaticPropertyKeyName(property);
          return name !== null && name !== "__proto__" && !isPoisonKey(name, consumed);
        });
      if (!isNodeOfType(value, "Identifier")) return false;
      const symbol = sourceModule.scopes.symbolFor(value);
      if (!symbol || seen.has(symbol) || !isReadonly(symbol, sourceModule)) return false;
      const rest = readOwnParameterRest(symbol, sourceModule);
      if (rest) {
        if (
          !symbol.references.every(
            (reference) =>
              !isRuntimeRead(reference.identifier) ||
              findTransparentExpressionRoot(reference.identifier) ===
                findTransparentExpressionRoot(sourceUse),
          )
        )
          return false;
        return validateCallerFrontier(rest.owner, sourceModule, consumed, nextVisited);
      }
      if (!areClosedProducerReferences(symbol, sourceModule, sourceUse)) return false;
      const initializer = getDirectUnreassignedInitializer(symbol);
      return Boolean(
        initializer &&
        validateProps(initializer, sourceModule, sourceUse, new Set(seen).add(symbol)),
      );
    };
    const validateOpening = (
      opening: EsTreeNodeOfType<"JSXOpeningElement">,
      sourceModule: SourceProjectModule,
    ): boolean => {
      const names = new Set<string>();
      return opening.attributes.every((attribute) => {
        if (isNodeOfType(attribute, "JSXSpreadAttribute"))
          return validateProps(attribute.argument, sourceModule, attribute.argument);
        if (!isNodeOfType(attribute, "JSXAttribute")) return false;
        const name = getJsxAttributeName(attribute.name);
        if (!name || names.has(name) || isPoisonKey(name, consumed)) return false;
        names.add(name);
        return true;
      });
    };
    for (const [binding, sourceModule] of bindings) {
      if (!isReadonly(binding, sourceModule)) return false;
      for (const reference of binding.references) {
        if (!isRuntimeRead(reference.identifier)) continue;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === root
        ) {
          if (isNodeOfType(parent, "JSXOpeningElement") && !validateOpening(parent, sourceModule))
            return false;
          continue;
        }
        if (
          isNodeOfType(parent, "ExportSpecifier") ||
          isNodeOfType(parent, "ExportDefaultDeclaration")
        )
          continue;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = sourceModule.scopes.symbolFor(parent.id);
          if (!alias || !isReadonly(alias, sourceModule)) return false;
          bindings.set(alias, sourceModule);
          continue;
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === root &&
          getStaticPropertyName(parent) === "bind"
        ) {
          const member = findTransparentExpressionRoot(parent);
          const call = member.parent;
          const argument =
            isNodeOfType(call, "CallExpression") &&
            call.arguments.length === OWNED_INPUT_SINGLE_COUNT
              ? call.arguments[OWNED_INPUT_EMPTY_COUNT]
              : null;
          const declaration = call ? findTransparentExpressionRoot(call).parent : null;
          if (
            !isNodeOfType(call, "CallExpression") ||
            call.optional ||
            parent.optional ||
            call.callee !== member ||
            !isNodeOfType(argument, "ObjectExpression") ||
            argument.properties.length !== OWNED_INPUT_EMPTY_COUNT ||
            !isNodeOfType(declaration, "VariableDeclarator") ||
            !isNodeOfType(declaration.id, "Identifier")
          )
            return false;
          const alias = sourceModule.scopes.symbolFor(declaration.id);
          if (!alias || !isReadonly(alias, sourceModule)) return false;
          bindings.set(alias, sourceModule);
          continue;
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === root &&
          !parent.optional &&
          isNodeOfType(parent.parent, "AssignmentExpression") &&
          parent.parent.left === parent &&
          parent.parent.operator === "="
        ) {
          const name = getStaticPropertyName(parent);
          if (
            name === "displayName" &&
            isNodeOfType(parent.parent.right, "Literal") &&
            typeof parent.parent.right.value === "string"
          )
            continue;
          if (
            (name === "propTypes" || name === "defaultProps" || name === "args") &&
            validateProps(parent.parent.right, sourceModule, parent.parent.right)
          )
            continue;
          return false;
        }
        if (
          isNodeOfType(parent, "Property") &&
          parent.value === root &&
          !parent.computed &&
          !parent.method &&
          parent.kind === "init" &&
          getStaticPropertyKeyName(parent) === "component" &&
          isNodeOfType(parent.parent, "ObjectExpression") &&
          parent.parent.properties.length === OWNED_INPUT_PAIR_COUNT &&
          parent.parent.properties.every(
            (property) =>
              isNodeOfType(property, "Property") &&
              property.kind === "init" &&
              !property.computed &&
              !property.method &&
              (property === parent ||
                (getStaticPropertyKeyName(property) === "title" &&
                  isNodeOfType(property.value, "Literal") &&
                  typeof property.value.value === "string")),
          )
        )
          continue;
        return false;
      }
    }
    return true;
  };
  const areClosedBorrowedTargets = (
    calls: ReadonlyArray<EsTreeNodeOfType<"CallExpression">>,
  ): boolean => {
    const callSet = new Set(calls);
    const parameters = new Map<SymbolDescriptor, EsTreeNode>();
    const resolveTarget = (
      rawValue: EsTreeNode,
      seen = new Set<SymbolDescriptor>(),
    ): SymbolDescriptor | null => {
      const value = stripParenExpression(rawValue);
      if (isNodeOfType(value, "Identifier")) {
        const symbol = module.scopes.symbolFor(value);
        if (!symbol || seen.has(symbol) || !isReadonly(symbol, module)) return null;
        const initializer = getDirectConstInitializer(symbol);
        return initializer ? resolveTarget(initializer, new Set(seen).add(symbol)) : null;
      }
      if (
        !isNodeOfType(value, "MemberExpression") ||
        value.optional ||
        getStaticPropertyName(value) !== "target" ||
        isMemberMutationTarget(value)
      )
        return null;
      const receiver = stripParenExpression(value.object);
      const parameter = isNodeOfType(receiver, "Identifier")
        ? module.scopes.symbolFor(receiver)
        : null;
      const callback = parameter ? findEnclosingFunction(parameter.declarationNode) : null;
      if (
        !parameter ||
        !callback ||
        !isFunctionLike(callback) ||
        callback.async ||
        callback.generator ||
        callback.params.length !== OWNED_INPUT_SINGLE_COUNT ||
        callback.params[OWNED_INPUT_EMPTY_COUNT] !== parameter.bindingIdentifier ||
        !isReadonly(parameter, module)
      )
        return null;
      parameters.set(parameter, callback);
      return parameter;
    };
    for (const call of calls) {
      const argument = call.arguments[OWNED_INPUT_EMPTY_COUNT];
      if (
        !argument ||
        isNodeOfType(argument, "SpreadElement") ||
        !isBooleanUse(call) ||
        !resolveTarget(argument)
      )
        return false;
    }
    for (const [parameter, callback] of parameters) {
      const aliases = new Set<SymbolDescriptor>();
      const closedTargetRead = (rawValue: EsTreeNode): boolean => {
        const value = findTransparentExpressionRoot(rawValue);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = module.scopes.symbolFor(parent.id);
          if (!alias || getDirectConstInitializer(alias) !== value || !isReadonly(alias, module))
            return false;
          if (aliases.has(alias)) return true;
          aliases.add(alias);
          return alias.references.every(
            (reference) =>
              !isRuntimeRead(reference.identifier) || closedTargetRead(reference.identifier),
          );
        }
        return (
          isNodeOfType(parent, "CallExpression") &&
          callSet.has(parent) &&
          parent.arguments[OWNED_INPUT_EMPTY_COUNT] === value
        );
      };
      if (
        !parameter.references.every((reference) => {
          if (!isRuntimeRead(reference.identifier)) return true;
          const root = findTransparentExpressionRoot(reference.identifier);
          const parent = root.parent;
          return (
            isNodeOfType(parent, "MemberExpression") &&
            parent.object === root &&
            !parent.optional &&
            getStaticPropertyName(parent) === "target" &&
            !isMemberMutationTarget(parent) &&
            closedTargetRead(parent)
          );
        })
      )
        return false;
      let hiddenReceiver = false;
      walkAst(callback, (node) => {
        if (
          isNodeOfType(node, "ThisExpression") ||
          isNodeOfType(node, "Super") ||
          isNodeOfType(node, "MetaProperty") ||
          (isNodeOfType(node, "Identifier") &&
            isRuntimeRead(node) &&
            (node.name === "arguments" ||
              (node.name === "event" && module.scopes.isGlobalReference(node))))
        )
          hiddenReceiver = true;
      });
      if (hiddenReceiver) return false;
      const roots = getFunctionBindingSymbols(callback, module.scopes);
      if (!roots.length) return false;
      const callbackBindings = new Set(roots);
      let registered = false;
      for (const binding of callbackBindings) {
        if (!isReadonly(binding, module)) return false;
        for (const reference of binding.references) {
          if (!isRuntimeRead(reference.identifier)) continue;
          const root = findTransparentExpressionRoot(reference.identifier);
          const parent = root.parent;
          if (parent && isGlobalListener(parent, root, module)) {
            const callee = isNodeOfType(parent, "CallExpression")
              ? stripParenExpression(parent.callee)
              : null;
            if (
              isNodeOfType(callee, "MemberExpression") &&
              getStaticPropertyName(callee) === "addEventListener"
            )
              registered = true;
            continue;
          }
          if (
            isNodeOfType(parent, "VariableDeclarator") &&
            parent.init === root &&
            isNodeOfType(parent.id, "Identifier")
          ) {
            const alias = module.scopes.symbolFor(parent.id);
            if (alias && getDirectConstInitializer(alias) === root && isReadonly(alias, module)) {
              callbackBindings.add(alias);
              continue;
            }
          }
          return false;
        }
      }
      if (!registered) return false;
    }
    return parameters.size > OWNED_INPUT_EMPTY_COUNT;
  };
  walkAst(module.programNode, (node) => {
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "Identifier") ||
      !node.init
    )
      return;
    const ref = module.scopes.symbolFor(node.id);
    const initial = stripParenExpression(node.init);
    const owner = findEnclosingFunction(node);
    if (
      !ref ||
      !owner ||
      !isFunctionLike(owner) ||
      owner.async ||
      owner.generator ||
      owner.params.length !== OWNED_INPUT_SINGLE_COUNT ||
      !isNodeOfType(owner.params[OWNED_INPUT_EMPTY_COUNT], "ObjectPattern") ||
      !isReadonly(ref, module) ||
      getDirectConstInitializer(ref) !== node.init ||
      !isNodeOfType(initial, "CallExpression") ||
      initial.optional ||
      !isProvenUnmodifiedReactApiCall(initial, "useRef", module.scopes)
    )
      return;
    const [initialValue, ...extra] = initial.arguments;
    const initialNode = initialValue ? stripParenExpression(initialValue) : null;
    if (
      extra.length ||
      (initialNode && !(isNodeOfType(initialNode, "Literal") && initialNode.value === null))
    )
      return;
    const parameterRest = readRestPattern(owner.params[OWNED_INPUT_EMPTY_COUNT], owner, module);
    if (!parameterRest) return;
    const publications: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
    const calls: EsTreeNodeOfType<"CallExpression">[] = [];
    const closed = ref.references.every((reference) => {
      if (!isRuntimeRead(reference.identifier)) return true;
      const value = findTransparentExpressionRoot(reference.identifier);
      const parent = value.parent;
      if (
        isNodeOfType(parent, "JSXExpressionContainer") &&
        parent.expression === value &&
        isNodeOfType(parent.parent, "JSXAttribute") &&
        getJsxAttributeName(parent.parent.name) === "ref" &&
        isNodeOfType(parent.parent.parent, "JSXOpeningElement")
      ) {
        publications.push(parent.parent.parent);
        return true;
      }
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== value ||
        getStaticPropertyName(parent) !== "current" ||
        isMemberMutationTarget(parent)
      )
        return false;
      if (isBooleanUse(parent)) return true;
      const current = findTransparentExpressionRoot(parent);
      const contains = current.parent;
      if (
        !isNodeOfType(contains, "MemberExpression") ||
        contains.object !== current ||
        getStaticPropertyName(contains) !== "contains" ||
        isMemberMutationTarget(contains)
      )
        return false;
      const method = findTransparentExpressionRoot(contains);
      const call = method.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== method ||
        call.arguments.length !== OWNED_INPUT_SINGLE_COUNT ||
        isNodeOfType(call.arguments[OWNED_INPUT_EMPTY_COUNT], "SpreadElement")
      )
        return false;
      calls.push(call);
      return true;
    });
    if (!closed || publications.length !== OWNED_INPUT_SINGLE_COUNT || !calls.length) return;
    const opening = publications[OWNED_INPUT_EMPTY_COUNT];
    if (!resolveHostName(opening, module)) return;
    let spreads = OWNED_INPUT_EMPTY_COUNT;
    const attributeNames = new Set<string>();
    if (
      !opening.attributes.every((attribute) => {
        if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
          const value = stripParenExpression(attribute.argument);
          if (opening.attributes.at(-OWNED_INPUT_SINGLE_COUNT) !== attribute) return false;
          if (
            !isNodeOfType(value, "Identifier") ||
            module.scopes.symbolFor(value) !== parameterRest.symbol
          )
            return false;
          spreads += OWNED_INPUT_SINGLE_COUNT;
          return parameterRest.symbol.references.every(
            (reference) =>
              !isRuntimeRead(reference.identifier) ||
              findTransparentExpressionRoot(reference.identifier) ===
                findTransparentExpressionRoot(attribute.argument),
          );
        }
        if (!isNodeOfType(attribute, "JSXAttribute")) return false;
        const name = getJsxAttributeName(attribute.name);
        if (
          !name ||
          attributeNames.has(name) ||
          (name !== "ref" &&
            (OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) || isEventHandlerName(name)))
        )
          return false;
        attributeNames.add(name);
        return true;
      }) ||
      spreads !== OWNED_INPUT_SINGLE_COUNT
    )
      return;
    const element = opening.parent;
    const returned = element ? findTransparentExpressionRoot(element) : null;
    if (
      !returned ||
      !isNodeOfType(returned.parent, "ReturnStatement") ||
      returned.parent.argument !== returned ||
      !isNodeOfType(returned.parent.parent, "BlockStatement") ||
      returned.parent.parent.parent !== owner ||
      returned.parent.parent.body.at(-OWNED_INPUT_SINGLE_COUNT) !== returned.parent
    )
      return;
    let abrupt = false;
    walkAst(owner, (child) => {
      if (child !== owner && isFunctionLike(child)) return false;
      if (
        (isNodeOfType(child, "ReturnStatement") && child !== returned.parent) ||
        isNodeOfType(child, "ThrowStatement")
      )
        abrupt = true;
    });
    if (
      abrupt ||
      !validateCallerFrontier(owner, module, parameterRest.consumed) ||
      !areClosedBorrowedTargets(calls)
    )
      return;
    for (const call of calls) {
      const argument = call.arguments[OWNED_INPUT_EMPTY_COUNT];
      if (argument && !isNodeOfType(argument, "SpreadElement")) {
        approvedArguments.add(argument);
        approvedArguments.add(findTransparentExpressionRoot(argument));
      }
    }
  });
  return approvedArguments;
};
