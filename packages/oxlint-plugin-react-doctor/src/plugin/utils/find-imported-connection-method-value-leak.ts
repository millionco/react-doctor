import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP } from "../constants/dom.js";
import {
  OBJECT_PROTOTYPE_PROPERTY_NAMES,
  IMPORTED_CONNECTION_SINGLE_COUNT,
  IMPORTED_CONNECTION_METHOD_COUNT,
  IMPORTED_CONNECTION_NATIVE_METHODS,
  IMPORTED_CONNECTION_NATIVE_FIELDS,
  IMPORTED_CONNECTION_NATIVE_EVENTS,
  IMPORTED_CONNECTION_PASSIVE_OBJECT_METHODS,
  IMPORTED_CONNECTION_HELPER_MAX_DEPTH,
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getClassBindingSymbol } from "./get-class-binding-symbol.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "./is-proven-global-namespace-reference.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasImportedConnectionSourceEnvironment } from "./has-imported-connection-source-environment.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasUnindexedRuntimeSource } from "./has-unindexed-runtime-source.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ImportedConnectionClass {
  readonly module: SourceProjectModule;
  readonly node: EsTreeNodeOfType<"ClassDeclaration">;
  readonly methods: ReadonlyMap<string, EsTreeNodeOfType<"FunctionExpression">>;
  readonly fields: ReadonlySet<string>;
}
interface ImportedConnectionAllocation {
  readonly method: EsTreeNodeOfType<"FunctionExpression">;
  readonly resource: EsTreeNodeOfType<"Identifier">;
  readonly slot: string;
  readonly storage: EsTreeNodeOfType<"AssignmentExpression">;
  readonly constructorName: string;
  readonly skippedGuards: ReadonlySet<EsTreeNode>;
}
interface ImportedConnectionRelease {
  readonly name: string;
  readonly slotReads: ReadonlySet<EsTreeNode>;
}

const isDirectCall = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  return (
    isNodeOfType(root.parent, "CallExpression") &&
    root.parent.callee === root &&
    !root.parent.optional
  );
};
const hasClosedSymbolReads = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
  permitted: (reference: EsTreeNode) => boolean,
): boolean =>
  hasOnlyAllowedSymbolReads({
    symbol,
    scopes: module.scopes,
    program: module.programNode,
    allowedIdentifiers: new Set(
      symbol.references
        .filter((reference) => permitted(reference.identifier))
        .map((reference) => reference.identifier),
    ),
  });
const getDirectStaticMember = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const member = stripParenExpression(expression);
  return isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    !member.computed &&
    getStaticPropertyName(member) !== null
    ? member
    : null;
};
const isOwnResourceSlot = (expression: EsTreeNode, slot: string): boolean => {
  const member = getDirectStaticMember(expression);
  return Boolean(
    member &&
    isNodeOfType(member.object, "ThisExpression") &&
    getStaticPropertyName(member) === slot,
  );
};
const isPassiveLiteralData = (expression: EsTreeNode): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal"))
    return value.value === null || ["string", "boolean", "number"].includes(typeof value.value);
  if (isNodeOfType(value, "ArrayExpression"))
    return value.elements.every(
      (element) =>
        element === null ||
        (!isNodeOfType(element, "SpreadElement") && isPassiveLiteralData(element)),
    );
  const properties = getOwnDataObjectProperties(value);
  return properties !== null && [...properties.values()].every(isPassiveLiteralData);
};
const getImportedClassName = (symbol: SymbolDescriptor): string | null =>
  isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
    ? "default"
    : (getImportedName(symbol.declarationNode) ?? null);

const hasClosedMutationReceiver = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let receiver = expression;
  const visited = new Set<SymbolDescriptor>();
  while (true) {
    const current = stripParenExpression(receiver);
    if (isNodeOfType(current, "ObjectExpression") || isNodeOfType(current, "ArrayExpression"))
      return true;
    if (isNodeOfType(current, "ThisExpression")) {
      let owner: EsTreeNode | null = findEnclosingFunction(current);
      while (isNodeOfType(owner, "ArrowFunctionExpression")) owner = findEnclosingFunction(owner);
      const method: EsTreeNode | null | undefined = owner?.parent;
      const classBody: EsTreeNode | null | undefined = method?.parent;
      const declaration: EsTreeNode | null | undefined = classBody?.parent;
      return Boolean(
        isNodeOfType(method, "MethodDefinition") &&
        method.value === owner &&
        method.kind === "method" &&
        !method.static &&
        !method.computed &&
        isNodeOfType(classBody, "ClassBody") &&
        isNodeOfType(declaration, "ClassDeclaration") &&
        !declaration.superClass,
      );
    }
    if (!isNodeOfType(current, "Identifier")) return false;
    const symbol = scopes.symbolFor(current);
    if (!symbol || hasSymbolBindingWrites(symbol) || visited.has(symbol)) return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    visited.add(symbol);
    receiver = initializer;
  }
};

const hasStableResourceSlotMutations = (module: SourceProjectModule, slot: string): boolean => {
  let stable = true;
  walkAst(module.programNode, (node) => {
    if (!stable) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (!isNodeOfType(node, "MemberExpression") || !isMemberMutationTarget(node)) return;
    const propertyName = getResolvedStaticPropertyName(node, module.scopes);
    if (propertyName === slot && !hasClosedMutationReceiver(node.object, module.scopes))
      stable = false;
  });
  return stable;
};

const moduleHasStableProviders = (
  module: SourceProjectModule,
  ownsClassCapability: boolean,
): boolean => {
  let stable =
    !hasReactDefaultProviderMutation("useEffect", module.scopes) &&
    !hasReactDefaultProviderMutation("useLayoutEffect", module.scopes) &&
    !hasReactDefaultProviderMutation("useRef", module.scopes);
  walkAst(module.programNode, (node) => {
    if (!stable) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      [
        "Object",
        "Reflect",
        "Function",
        "Array",
        "Promise",
        "globalThis",
        "window",
        "self",
        "global",
        ...SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
      ].includes(node.name)
    ) {
      const symbol = module.scopes.symbolFor(node);
      if (symbol && isErasedTypeScriptBinding(symbol)) stable = false;
    }
    const source = getRuntimeStaticDependencySource(node);
    if (
      ownsClassCapability &&
      source &&
      !source.startsWith(".") &&
      !source.startsWith("@/") &&
      source !== "react" &&
      source !== "next" &&
      !source.startsWith("next/")
    )
      stable = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, module.scopes);
      if (
        ["constructor", "prototype", "__proto__"].includes(name ?? "") ||
        (isMemberMutationTarget(node) && node.computed && name === null) ||
        (["call", "apply", "bind"].includes(name ?? "") && isDirectCall(node))
      )
        stable = false;
      if (
        isProvenGlobalObjectReference(node.object, module.scopes) &&
        ["global", "globalThis", "self", "window"].includes(name ?? "")
      )
        stable = false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      node.specifiers.length > 0 &&
      node.specifiers.every(
        (specifier) =>
          isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type",
      )
    )
      stable = false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    )
      stable = false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "require"
    )
      stable = false;
    for (const namespace of ["eval", "Function", "Reflect", "Array"])
      if (isProvenGlobalNamespaceReference(node, namespace, module.scopes)) stable = false;
    if (isProvenGlobalNamespaceReference(node, "Object", module.scopes)) {
      const root = findTransparentExpressionRoot(node);
      const member = getDirectStaticMember(root.parent ?? root);
      if (
        !member ||
        member.object !== root ||
        !IMPORTED_CONNECTION_PASSIVE_OBJECT_METHODS.has(getStaticPropertyName(member) ?? "") ||
        !isDirectCall(member)
      )
        stable = false;
    }
    for (const namespace of [...SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP, "Promise"])
      if (isProvenGlobalNamespaceReference(node, namespace, module.scopes)) {
        const root = findTransparentExpressionRoot(node);
        if (!isNodeOfType(root.parent, "NewExpression") || root.parent.callee !== root)
          stable = false;
      }
    if (isProvenGlobalNamespaceReference(node, "React", module.scopes)) stable = false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      isProvenGlobalObjectReference(node, module.scopes)
    ) {
      const root = findTransparentExpressionRoot(node);
      const member = getDirectStaticMember(root.parent ?? root);
      if (!member || member.object !== root) stable = false;
    }
  });
  return stable;
};

const classShape = (
  node: EsTreeNode,
  module: SourceProjectModule,
): ImportedConnectionClass | null => {
  if (
    !isNodeOfType(node, "ClassDeclaration") ||
    !node.id ||
    node.superClass ||
    node.decorators?.length ||
    ("abstract" in node && node.abstract === true) ||
    ("declare" in node && node.declare === true)
  )
    return null;
  const methods = new Map<string, EsTreeNodeOfType<"FunctionExpression">>();
  const fields = new Set<string>();
  for (const element of node.body.body) {
    if (!isNodeOfType(element, "MethodDefinition") && !isNodeOfType(element, "PropertyDefinition"))
      return null;
    if (element.static || element.decorators?.length || element.computed) return null;
    const name = getStaticPropertyKeyName(element);
    if (
      !name ||
      name === "constructor" ||
      name === "__proto__" ||
      methods.has(name) ||
      fields.has(name)
    )
      return null;
    if (isNodeOfType(element, "PropertyDefinition") && !element.value) fields.add(name);
    else if (
      isNodeOfType(element, "MethodDefinition") &&
      element.kind === "method" &&
      isNodeOfType(element.value, "FunctionExpression") &&
      !element.value.generator
    )
      methods.set(name, element.value);
    else return null;
  }
  if (
    module.programNode.body.some((statement) => {
      if (
        statement === node ||
        isNodeOfType(statement, "FunctionDeclaration") ||
        isNodeOfType(statement, "TSInterfaceDeclaration") ||
        isNodeOfType(statement, "TSTypeAliasDeclaration")
      )
        return false;
      if (isNodeOfType(statement, "ImportDeclaration")) return statement.importKind !== "type";
      if (isNodeOfType(statement, "ExportDefaultDeclaration"))
        return (
          statement.declaration !== node &&
          !(
            isNodeOfType(statement.declaration, "Identifier") &&
            statement.declaration.name === node.id?.name
          )
        );
      if (isNodeOfType(statement, "ExportNamedDeclaration"))
        return Boolean(
          statement.source || (statement.declaration && statement.declaration !== node),
        );
      if (
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "Literal")
      )
        return !["use strict", "use client"].includes(String(statement.expression.value));
      return true;
    })
  )
    return null;
  if (methods.size !== IMPORTED_CONNECTION_METHOD_COUNT) return null;
  const binding = getClassBindingSymbol(node, module.scopes);
  if (
    !binding ||
    !hasClosedSymbolReads(
      binding,
      module,
      (reference) =>
        isNonReferenceIdentifier(reference) ||
        (isNodeOfType(reference.parent, "ExportSpecifier") && reference.parent.local === reference),
    )
  )
    return null;
  return { module, node, methods, fields };
};

const findAllocation = (
  shape: ImportedConnectionClass,
  methodName: string,
): ImportedConnectionAllocation | null => {
  const method = shape.methods.get(methodName);
  if (
    !method ||
    !isNodeOfType(method.body, "BlockStatement") ||
    method.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return null;
  for (let index = 0; index < method.body.body.length; index += 1) {
    const declaration = method.body.body[index];
    if (
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const" ||
      declaration.declarations.length !== IMPORTED_CONNECTION_SINGLE_COUNT
    )
      continue;
    const declarator = declaration.declarations[0];
    const initializer = declarator.init ? stripParenExpression(declarator.init) : null;
    if (
      !isNodeOfType(declarator.id, "Identifier") ||
      !isNodeOfType(initializer, "NewExpression") ||
      !isNodeOfType(initializer.callee, "Identifier") ||
      !SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP.has(initializer.callee.name) ||
      !shape.module.scopes.isGlobalReference(initializer.callee) ||
      initializer.arguments.some(
        (argument) => isNodeOfType(argument, "SpreadElement") || !isPassiveLiteralData(argument),
      )
    )
      continue;
    const next = method.body.body[index + IMPORTED_CONNECTION_SINGLE_COUNT];
    const assignment = isNodeOfType(next, "ExpressionStatement") ? next.expression : null;
    const member = isNodeOfType(assignment, "AssignmentExpression")
      ? getDirectStaticMember(assignment.left)
      : null;
    const slot = member ? getStaticPropertyName(member) : null;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !member ||
      !isNodeOfType(member.object, "ThisExpression") ||
      !slot ||
      OBJECT_PROTOTYPE_PROPERTY_NAMES.has(slot) ||
      !shape.fields.has(slot) ||
      !isNodeOfType(assignment.right, "Identifier") ||
      shape.module.scopes.symbolFor(assignment.right) !==
        shape.module.scopes.symbolFor(declarator.id)
    )
      continue;
    const guards = new Set<EsTreeNode>();
    for (const statement of method.body.body.slice(0, index)) {
      if (
        !isNodeOfType(statement, "IfStatement") ||
        statement.alternate ||
        !isOwnResourceSlot(statement.test, slot)
      )
        return null;
      guards.add(statement);
    }
    return {
      method,
      resource: declarator.id,
      slot,
      storage: assignment,
      constructorName: initializer.callee.name,
      skippedGuards: guards,
    };
  }
  return null;
};

const findRelease = (
  shape: ImportedConnectionClass,
  allocation: ImportedConnectionAllocation,
): ImportedConnectionRelease | null => {
  for (const [name, method] of shape.methods) {
    if (
      method === allocation.method ||
      method.params.length !== 0 ||
      !isNodeOfType(method.body, "BlockStatement")
    )
      continue;
    const slots = new Set<EsTreeNode>();
    const aliases = new Set<SymbolDescriptor>();
    let released = false;
    let supported = true;
    for (const statement of method.body.body) {
      if (released) break;
      if (
        isNodeOfType(statement, "IfStatement") &&
        !statement.alternate &&
        isNodeOfType(statement.test, "UnaryExpression") &&
        statement.test.operator === "!" &&
        isOwnResourceSlot(statement.test.argument, allocation.slot) &&
        isNodeOfType(statement.consequent, "BlockStatement") &&
        statement.consequent.body.length === IMPORTED_CONNECTION_SINGLE_COUNT &&
        isNodeOfType(statement.consequent.body[0], "ReturnStatement") &&
        !statement.consequent.body[0].argument
      ) {
        slots.add(stripParenExpression(statement.test.argument));
        continue;
      }
      if (
        isNodeOfType(statement, "VariableDeclaration") &&
        statement.kind === "const" &&
        statement.declarations.length === IMPORTED_CONNECTION_SINGLE_COUNT
      ) {
        const declaration = statement.declarations[0];
        const value = declaration.init ? stripParenExpression(declaration.init) : null;
        if (!isNodeOfType(declaration.id, "Identifier") || !value) {
          supported = false;
          break;
        }
        if (isOwnResourceSlot(value, allocation.slot)) {
          const symbol = shape.module.scopes.symbolFor(declaration.id);
          if (!symbol) {
            supported = false;
            break;
          }
          aliases.add(symbol);
          slots.add(value);
          continue;
        }
        const field = getDirectStaticMember(value);
        if (
          field &&
          isNodeOfType(field.object, "ThisExpression") &&
          shape.fields.has(getStaticPropertyName(field) ?? "") &&
          getStaticPropertyName(field) !== allocation.slot
        )
          continue;
        if (isPassiveLiteralData(value)) continue;
      }
      if (isNodeOfType(statement, "ExpressionStatement")) {
        const value = stripParenExpression(statement.expression);
        if (
          isNodeOfType(value, "UnaryExpression") &&
          value.operator === "delete" &&
          isOwnResourceSlot(value.argument, allocation.slot)
        ) {
          slots.add(stripParenExpression(value.argument));
          continue;
        }
        if (
          isNodeOfType(value, "CallExpression") &&
          !value.optional &&
          value.arguments.length === 0
        ) {
          const callee = getDirectStaticMember(value.callee);
          if (
            callee &&
            getStaticPropertyName(callee) === "close" &&
            isNodeOfType(callee.object, "Identifier") &&
            [...aliases].some((symbol) => symbol === shape.module.scopes.symbolFor(callee.object))
          ) {
            released = true;
            continue;
          }
        }
      }
      supported = false;
      break;
    }
    if (!supported || !released || aliases.size !== IMPORTED_CONNECTION_SINGLE_COUNT) continue;
    if (
      ![...aliases].every((symbol) =>
        hasClosedSymbolReads(symbol, shape.module, (reference) => {
          const member = getDirectStaticMember(reference.parent ?? reference);
          return Boolean(
            member &&
            member.object === reference &&
            getStaticPropertyName(member) === "close" &&
            isDirectCall(member),
          );
        }),
      )
    )
      continue;
    return { name, slotReads: slots };
  }
  return null;
};

const hasClosedNativeMethodResult = (
  member: EsTreeNodeOfType<"MemberExpression">,
  module: SourceProjectModule,
): boolean => {
  const call = findTransparentExpressionRoot(member).parent;
  if (!isNodeOfType(call, "CallExpression")) return false;
  const result = findTransparentExpressionRoot(call);
  if (getStaticPropertyName(member) === "addTransceiver")
    return isNodeOfType(result.parent, "ExpressionStatement");
  if (getStaticPropertyName(member) !== "getTransceivers") return true;
  if (isNodeOfType(result.parent, "ExpressionStatement")) return true;
  const filter = getDirectStaticMember(result.parent ?? result);
  const filterCall = filter ? findTransparentExpressionRoot(filter).parent : null;
  if (
    !filter ||
    filter.object !== result ||
    getStaticPropertyName(filter) !== "filter" ||
    !isNodeOfType(filterCall, "CallExpression") ||
    filterCall.callee !== filter ||
    filterCall.arguments.length !== IMPORTED_CONNECTION_SINGLE_COUNT
  )
    return false;
  const callback = stripParenExpression(filterCall.arguments[0]);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return false;
  const parameter = module.scopes.symbolFor(callback.params[0]);
  if (
    !parameter ||
    !hasClosedSymbolReads(parameter, module, (reference) => {
      const property = getDirectStaticMember(reference.parent ?? reference);
      return Boolean(
        property &&
        property.object === reference &&
        ["mid", "currentDirection"].includes(getStaticPropertyName(property) ?? "") &&
        !isMemberMutationTarget(property),
      );
    })
  )
    return false;
  const filtered = findTransparentExpressionRoot(filterCall);
  const declaration = filtered.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== filtered ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const values = module.scopes.symbolFor(declaration.id);
  return Boolean(
    values &&
    hasClosedSymbolReads(values, module, (reference) => {
      const property = getDirectStaticMember(reference.parent ?? reference);
      return Boolean(
        property &&
        property.object === reference &&
        getStaticPropertyName(property) === "length" &&
        !isMemberMutationTarget(property),
      );
    }),
  );
};

const hasClosedResourceUses = (
  identifier: EsTreeNodeOfType<"Identifier">,
  module: SourceProjectModule,
  storage: EsTreeNode | null,
  depth = 0,
  visited = new Set<EsTreeNode>(),
): boolean => {
  if (depth > IMPORTED_CONNECTION_HELPER_MAX_DEPTH) return false;
  const symbol = module.scopes.symbolFor(identifier);
  if (!symbol) return false;
  return hasClosedSymbolReads(symbol, module, (reference) => {
    const root = findTransparentExpressionRoot(reference);
    if (
      storage &&
      isNodeOfType(root.parent, "AssignmentExpression") &&
      root.parent === storage &&
      root.parent.right === root
    )
      return true;
    const member = getDirectStaticMember(root.parent ?? root);
    if (member && member.object === root) {
      const name = getStaticPropertyName(member) ?? "";
      if (IMPORTED_CONNECTION_NATIVE_METHODS.has(name))
        return (
          !isMemberMutationTarget(member) &&
          isDirectCall(member) &&
          hasClosedNativeMethodResult(member, module)
        );
      if (IMPORTED_CONNECTION_NATIVE_FIELDS.has(name)) return !isMemberMutationTarget(member);
      if (IMPORTED_CONNECTION_NATIVE_EVENTS.has(name)) {
        const assignment = member.parent;
        if (
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.operator !== "=" ||
          assignment.left !== member ||
          !isNodeOfType(assignment.right, "ArrowFunctionExpression")
        )
          return false;
        return assignment.right.params.every((parameter) => {
          if (!isNodeOfType(parameter, "Identifier")) return false;
          const parameterSymbol = module.scopes.symbolFor(parameter);
          return Boolean(
            parameterSymbol &&
            hasClosedSymbolReads(parameterSymbol, module, (eventReference) => {
              const property = getDirectStaticMember(eventReference.parent ?? eventReference);
              return Boolean(
                property &&
                property.object === eventReference &&
                getStaticPropertyName(property) === "track" &&
                !isMemberMutationTarget(property),
              );
            }),
          );
        });
      }
      return false;
    }
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      !call.arguments.some((argument) => argument === root) ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const helper = resolveExactLocalFunction(call.callee, module.scopes);
    if (!helper || visited.has(helper) || !isFunctionLike(helper) || helper.generator) return false;
    const binding = getDirectFunctionBindingIdentifier(helper);
    const helperSymbol = binding ? module.scopes.symbolFor(binding) : null;
    if (!helperSymbol || !hasClosedSymbolReads(helperSymbol, module, isDirectCall)) return false;
    const parameter = helper.params[call.arguments.findIndex((argument) => argument === root)];
    return (
      isNodeOfType(parameter, "Identifier") &&
      hasClosedResourceUses(
        parameter,
        module,
        null,
        depth + IMPORTED_CONNECTION_SINGLE_COUNT,
        new Set([...visited, helper]),
      )
    );
  });
};

const hasClosedResourceSlotUses = (
  shape: ImportedConnectionClass,
  allocation: ImportedConnectionAllocation,
  release: ImportedConnectionRelease,
): boolean => {
  let supported = true;
  walkAst(shape.node, (node) => {
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ThisExpression")) {
      const member = getDirectStaticMember(node.parent ?? node);
      if (!member || member.object !== node) {
        supported = false;
        return;
      }
      const name = getStaticPropertyName(member);
      if (name === allocation.slot) {
        if (
          member === allocation.storage.left ||
          release.slotReads.has(member) ||
          [...allocation.skippedGuards].some(
            (guard) => guard.type === "IfStatement" && guard.test === member,
          )
        )
          return;
        supported = false;
      } else if (name && shape.methods.has(name)) {
        if (
          ![...allocation.skippedGuards].some((guard) => isAstDescendant(member, guard)) ||
          !isDirectCall(member) ||
          name !== release.name
        )
          supported = false;
      } else if (!name || !shape.fields.has(name)) supported = false;
    }
  });
  return supported && hasClosedResourceUses(allocation.resource, shape.module, allocation.storage);
};

const getNativePromiseMethodValueInvocation = (
  member: EsTreeNodeOfType<"MemberExpression">,
  cleanup: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const callback = findEnclosingFunction(member);
  if (
    !callback ||
    !isAstDescendant(callback, cleanup) ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    stripParenExpression(getSingleReturnExpression(callback) ?? callback) !== member
  )
    return null;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const reaction = callbackRoot.parent;
  if (
    !isNodeOfType(reaction, "CallExpression") ||
    !reaction.arguments.some((argument) => argument === callbackRoot)
  )
    return null;
  const callee = getDirectStaticMember(reaction.callee);
  if (!callee || getStaticPropertyName(callee) !== "then" || reaction.arguments[0] !== callbackRoot)
    return null;
  if (
    reaction.arguments.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
    !isFunctionLike(cleanup) ||
    !isNodeOfType(cleanup.body, "BlockStatement")
  )
    return null;
  let terminal: EsTreeNode = reaction;
  while (true) {
    const terminalRoot = findTransparentExpressionRoot(terminal);
    const continuation = getDirectStaticMember(terminalRoot.parent ?? terminalRoot);
    if (!continuation || continuation.object !== terminalRoot) {
      terminal = terminalRoot;
      break;
    }
    const continuationRoot = findTransparentExpressionRoot(continuation);
    const call = continuationRoot.parent;
    if (
      getStaticPropertyName(continuation) !== "catch" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== continuationRoot ||
      call.optional ||
      call.arguments.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
      isNodeOfType(call.arguments[0], "SpreadElement")
    )
      return null;
    terminal = call;
  }
  if (
    isNodeOfType(terminal.parent, "UnaryExpression") &&
    terminal.parent.operator === "void" &&
    terminal.parent.argument === terminal
  )
    terminal = findTransparentExpressionRoot(terminal.parent);
  if (
    !isNodeOfType(terminal.parent, "ExpressionStatement") ||
    terminal.parent.expression !== terminal ||
    terminal.parent.parent !== cleanup.body
  )
    return null;
  let promise: EsTreeNode = stripParenExpression(callee.object);
  while (isNodeOfType(promise, "CallExpression")) {
    const chained = getDirectStaticMember(promise.callee);
    if (!chained || !["then", "catch", "finally"].includes(getStaticPropertyName(chained) ?? ""))
      break;
    promise = stripParenExpression(chained.object);
  }
  if (!isNodeOfType(promise, "Identifier")) return null;
  const symbol = scopes.symbolFor(promise);
  const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
  const invoked = initializer ? stripParenExpression(initializer) : null;
  if (
    !symbol ||
    !hasOnlyAllowedSymbolReads({
      symbol,
      scopes,
      program: scopes.rootScope.node,
      allowedIdentifiers: new Set(
        symbol.references
          .filter((reference) => {
            const referenceRoot = findTransparentExpressionRoot(reference.identifier);
            const member = getDirectStaticMember(referenceRoot.parent ?? referenceRoot);
            return Boolean(
              member &&
              member.object === referenceRoot &&
              ["then", "catch", "finally"].includes(getStaticPropertyName(member) ?? "") &&
              isDirectCall(member),
            );
          })
          .map((reference) => reference.identifier),
      ),
    })
  )
    return null;
  if (!isNodeOfType(invoked, "CallExpression")) return null;
  const invokedFunction = stripParenExpression(invoked.callee);
  return isFunctionLike(invokedFunction) &&
    invokedFunction.async === true &&
    !invokedFunction.generator &&
    invokedFunction.params.length === 0 &&
    invoked.arguments.length === 0
    ? invoked
    : null;
};

const getDiscardedCleanupMethodValueInvocation = (
  member: EsTreeNodeOfType<"MemberExpression">,
  module: SourceProjectModule,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const reaction = findEnclosingFunction(member);
  const cleanup = reaction ? findEnclosingFunction(reaction) : null;
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length !== 0)
    return null;
  const cleanupRoot = findTransparentExpressionRoot(cleanup);
  const returned = cleanupRoot.parent;
  const callback = returned ? findEnclosingFunction(returned) : null;
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    returned.argument !== cleanupRoot ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    returned.parent !== callback.body
  )
    return null;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const effect = callbackRoot.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== callbackRoot ||
    !isReactApiCall(effect, new Set(["useEffect", "useLayoutEffect"]), module.scopes, {
      allowUnboundBareCalls: false,
      resolveNamedAliases: true,
    }) ||
    !isProvenUnmodifiedReactApiCall(
      effect,
      new Set(["useEffect", "useLayoutEffect"]),
      module.scopes,
    )
  )
    return null;
  return getNativePromiseMethodValueInvocation(member, cleanup, module.scopes);
};

const hasClosedInstanceMethodRead = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  shape: ImportedConnectionClass,
): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const member = getDirectStaticMember(root.parent ?? root);
  return Boolean(
    member &&
    member.object === root &&
    shape.methods.has(getStaticPropertyName(member) ?? "") &&
    !isMemberMutationTarget(member) &&
    (isDirectCall(member) || getDiscardedCleanupMethodValueInvocation(member, module)),
  );
};

const hasClosedInstanceCreation = (
  creation: EsTreeNode,
  module: SourceProjectModule,
  shape: ImportedConnectionClass,
): boolean => {
  if (!isNodeOfType(creation, "NewExpression") || creation.arguments.length !== 0) return false;
  const creationRoot = findTransparentExpressionRoot(creation);
  let initializer: EsTreeNode = creationRoot;
  let isRefCarrier = false;
  if (isNodeOfType(creationRoot.parent, "CallExpression")) {
    const call = creationRoot.parent;
    if (
      call.arguments.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
      call.arguments[0] !== creationRoot ||
      !isReactApiCall(call, new Set(["useRef"]), module.scopes, {
        allowUnboundBareCalls: false,
        resolveNamedAliases: true,
      }) ||
      !isProvenUnmodifiedReactApiCall(call, new Set(["useRef"]), module.scopes)
    )
      return false;
    initializer = findTransparentExpressionRoot(call);
    isRefCarrier = true;
  }
  const declarator = initializer.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== initializer ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    declarator.parent.declarations.length !== IMPORTED_CONNECTION_SINGLE_COUNT
  )
    return false;
  const instance = module.scopes.symbolFor(declarator.id);
  return Boolean(
    instance &&
    hasClosedSymbolReads(instance, module, (reference) => {
      if (!isRefCarrier) return hasClosedInstanceMethodRead(reference, module, shape);
      const root = findTransparentExpressionRoot(reference);
      const current = getDirectStaticMember(root.parent ?? root);
      return Boolean(
        current &&
        current.object === root &&
        getStaticPropertyName(current) === "current" &&
        !isMemberMutationTarget(current) &&
        hasClosedInstanceMethodRead(current, module, shape),
      );
    }),
  );
};

const hasClosedClassConsumers = (
  index: SourceProjectIndex,
  shape: ImportedConnectionClass,
  exportedName: string,
): boolean => {
  for (const module of index.modulesByFilePath.values()) {
    let supported = true;
    walkAst(module.programNode, (node) => {
      if (index.resolvedSourcePathByNode.get(node) !== shape.module.filePath) return;
      if (!isNodeOfType(node, "ImportDeclaration") || node.importKind === "type") {
        supported = false;
        return;
      }
      for (const specifier of node.specifiers) {
        const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
          ? "default"
          : getImportedName(specifier);
        const symbol =
          isNodeOfType(specifier, "ImportSpecifier") ||
          isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? module.scopes.symbolFor(specifier.local)
            : null;
        if (
          name !== exportedName ||
          !symbol ||
          (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") ||
          !hasClosedSymbolReads(symbol, module, (reference) => {
            if (isTypeScriptTypePosition(reference)) return true;
            const root = findTransparentExpressionRoot(reference);
            return (
              isNodeOfType(root.parent, "NewExpression") &&
              root.parent.callee === root &&
              root.parent.arguments.length === 0
            );
          })
        ) {
          supported = false;
          continue;
        }
        for (const reference of symbol.references) {
          if (isTypeScriptTypePosition(reference.identifier)) continue;
          const creation = findTransparentExpressionRoot(reference.identifier).parent;
          if (!creation || !hasClosedInstanceCreation(creation, module, shape)) supported = false;
        }
      }
    });
    if (!supported) return false;
  }
  return true;
};

const hasClosedMutatingClassReceivers = (
  index: SourceProjectIndex,
  allocation: ImportedConnectionAllocation,
  selectedShape: ImportedConnectionClass,
  selectedExportedName: string,
): boolean => {
  let supported = true;
  for (const module of index.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      if (!supported) return false;
      if (isTypeScriptTypePosition(node)) return false;
      if (!isNodeOfType(node, "ClassDeclaration")) return;
      let writesSlot = false;
      walkAst(node, (member) => {
        if (isTypeScriptTypePosition(member)) return false;
        if (
          isNodeOfType(member, "MemberExpression") &&
          isMemberMutationTarget(member) &&
          getResolvedStaticPropertyName(member, module.scopes) === allocation.slot
        )
          writesSlot = true;
      });
      if (!writesSlot) return;
      const shape = node === selectedShape.node ? selectedShape : classShape(node, module);
      if (!shape || !shape.node.id) {
        supported = false;
        return false;
      }
      const exportedName =
        node === selectedShape.node
          ? selectedExportedName
          : findExportedValue(module.programNode, "default") === node
            ? "default"
            : shape.node.id.name;
      if (!hasClosedClassConsumers(index, shape, exportedName)) {
        supported = false;
        return false;
      }
      walkAst(node, (reference) => {
        if (isTypeScriptTypePosition(reference)) return false;
        if (!isNodeOfType(reference, "ThisExpression")) return;
        const member = getDirectStaticMember(reference.parent ?? reference);
        const name = member ? getStaticPropertyName(member) : null;
        if (
          !member ||
          member.object !== reference ||
          !name ||
          (!shape.fields.has(name) &&
            !(shape.methods.has(name) && isDirectCall(member) && !isMemberMutationTarget(member)))
        )
          supported = false;
      });
    });
    if (!supported) return false;
  }
  return true;
};

export const findImportedConnectionMethodValueLeak = (
  effect: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (
    !context.filename ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !isReactApiCall(effect, new Set(["useEffect", "useLayoutEffect"]), context.scopes, {
      allowUnboundBareCalls: false,
      resolveNamedAliases: true,
    }) ||
    !isProvenUnmodifiedReactApiCall(
      effect,
      new Set(["useEffect", "useLayoutEffect"]),
      context.scopes,
    )
  )
    return null;
  const cleanupReturn = callback.body.body.at(-1);
  const cleanup = isNodeOfType(cleanupReturn, "ReturnStatement") ? cleanupReturn.argument : null;
  if (!cleanup || !isFunctionLike(cleanup)) return null;
  const filename = path.resolve(context.filename);
  const rootDirectory = findNearestPackageDirectory(filename);
  const program = context.scopes.rootScope.node;
  if (!rootDirectory || !isNodeOfType(program, "Program")) return null;
  for (const statement of callback.body.body) {
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== IMPORTED_CONNECTION_SINGLE_COUNT
    )
      continue;
    const declarator = statement.declarations[0];
    const creation = declarator.init ? stripParenExpression(declarator.init) : null;
    if (
      !isNodeOfType(declarator.id, "Identifier") ||
      !isNodeOfType(creation, "NewExpression") ||
      creation.arguments.length !== 0
    )
      continue;
    const constructor = stripParenExpression(creation.callee);
    if (!isNodeOfType(constructor, "Identifier")) continue;
    const imported = context.scopes.symbolFor(constructor);
    const declaration = imported ? getImportDeclarationForSymbol(imported) : null;
    const exportedName = imported ? getImportedClassName(imported) : null;
    if (
      !imported ||
      imported.kind !== "import" ||
      !declaration ||
      declaration.importKind === "type" ||
      (isNodeOfType(imported.declarationNode, "ImportSpecifier") &&
        imported.declarationNode.importKind === "type") ||
      !exportedName ||
      typeof declaration.source.value !== "string"
    )
      continue;
    const index = buildSourceProjectIndex({
      rootDirectory,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeApplicationDirectories: true,
      sourceFileLimits: {
        maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
        maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
        maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
        maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
      },
    });
    if (
      !index ||
      index.hasOpaqueMdxConsumerSurface ||
      index.htmlFilePaths.length ||
      hasUnindexedRuntimeSource(index) ||
      [...index.unresolvedRuntimeSources].some(
        (source) =>
          source.startsWith(".") ||
          source.startsWith("/") ||
          source.startsWith("#") ||
          source.startsWith("@/"),
      )
    )
      continue;
    const resolved = resolveCrossFileValueExportWithFilePath(
      filename,
      declaration.source.value,
      exportedName,
      { requireCompleteReexports: true },
    );
    if (!resolved || resolved.contexts?.length !== IMPORTED_CONNECTION_SINGLE_COUNT) continue;
    const consumers = index.consumerModulesByFilePath.get(resolved.filePath);
    if (
      ![...index.modulesByFilePath.values()].every(
        (module) =>
          hasImportedConnectionSourceEnvironment(
            module,
            rootDirectory,
            module.filePath === filename ? (context.sourceCode?.getText?.() ?? null) : undefined,
          ) &&
          moduleHasStableProviders(
            module,
            module.filePath === resolved.filePath || consumers?.has(module) === true,
          ),
      )
    )
      continue;
    const module = index.modulesByFilePath.get(resolved.filePath);
    const shape = module ? classShape(resolved.exportedNode, module) : null;
    if (!shape || !hasClosedClassConsumers(index, shape, exportedName)) continue;
    const instance = context.scopes.symbolFor(declarator.id);
    if (!instance) continue;
    const calls: EsTreeNodeOfType<"CallExpression">[] = [];
    const values: EsTreeNodeOfType<"MemberExpression">[] = [];
    const promiseInvocations = new Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">>();
    let supported = true;
    if (
      !hasClosedSymbolReads(
        instance,
        { filePath: filename, programNode: program, scopes: context.scopes },
        (reference) => {
          const root = findTransparentExpressionRoot(reference);
          const member = getDirectStaticMember(root.parent ?? root);
          if (!member || member.object !== root || isMemberMutationTarget(member)) return false;
          const parent = findTransparentExpressionRoot(member).parent;
          if (
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === findTransparentExpressionRoot(member)
          ) {
            calls.push(parent);
            return true;
          }
          const promiseInvocation = getNativePromiseMethodValueInvocation(
            member,
            cleanup,
            context.scopes,
          );
          if (promiseInvocation) {
            values.push(member);
            promiseInvocations.set(member, promiseInvocation);
            return true;
          }
          return false;
        },
      )
    )
      continue;
    if (
      calls.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
      values.length !== IMPORTED_CONNECTION_SINGLE_COUNT
    )
      continue;
    const acquisition = calls[0];
    const callee = getDirectStaticMember(acquisition.callee);
    const methodName = callee ? getStaticPropertyName(callee) : null;
    const owner = findEnclosingFunction(acquisition);
    const invocation = promiseInvocations.get(values[0]);
    const invokedFunction = invocation ? stripParenExpression(invocation.callee) : null;
    const initializerRoot = invocation ? findTransparentExpressionRoot(invocation) : null;
    const initializer = initializerRoot?.parent;
    const promiseDeclaration = initializer?.parent;
    if (
      !invocation ||
      !isFunctionLike(invokedFunction) ||
      invokedFunction.async !== true ||
      invokedFunction.generator ||
      invokedFunction.params.length !== 0 ||
      invocation.arguments.length !== 0 ||
      !isNodeOfType(invokedFunction.body, "BlockStatement") ||
      !isNodeOfType(initializer, "VariableDeclarator") ||
      initializer.init !== initializerRoot ||
      !isNodeOfType(promiseDeclaration, "VariableDeclaration") ||
      promiseDeclaration.kind !== "const" ||
      promiseDeclaration.declarations.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
      promiseDeclaration.parent !== callback.body
    )
      continue;
    const firstStatement = invokedFunction.body.body.find(
      (statement) =>
        !isNodeOfType(statement, "EmptyStatement") &&
        !(
          isNodeOfType(statement, "ExpressionStatement") &&
          isLiteralVoidExpression(statement.expression)
        ),
    );
    const firstValue = isNodeOfType(firstStatement, "ExpressionStatement")
      ? stripParenExpression(firstStatement.expression)
      : isNodeOfType(firstStatement, "VariableDeclaration") &&
          firstStatement.kind === "const" &&
          firstStatement.declarations.length === IMPORTED_CONNECTION_SINGLE_COUNT &&
          isNodeOfType(firstStatement.declarations[0].id, "Identifier") &&
          firstStatement.declarations[0].init
        ? stripParenExpression(firstStatement.declarations[0].init)
        : null;
    if (
      !methodName ||
      owner !== invokedFunction ||
      !owner ||
      !isNodeOfType(firstValue, "AwaitExpression") ||
      stripParenExpression(firstValue.argument) !== acquisition ||
      acquisition.arguments.some(
        (argument) =>
          isNodeOfType(argument, "SpreadElement") ||
          (!isNodeOfType(argument, "Identifier") && !isPassiveLiteralData(argument)),
      ) ||
      !isNodeReachableWithinFunction(invocation, context) ||
      !isNodeReachableWithinFunction(acquisition, context)
    )
      continue;
    const allocation = findAllocation(shape, methodName);
    if (
      !allocation ||
      ![...index.modulesByFilePath.values()].every((projectModule) =>
        hasStableResourceSlotMutations(projectModule, allocation.slot),
      ) ||
      !hasClosedMutatingClassReceivers(index, allocation, shape, exportedName)
    )
      continue;
    const release = findRelease(shape, allocation);
    if (
      !release ||
      getStaticPropertyName(values[0]) !== release.name ||
      !hasClosedResourceSlotUses(shape, allocation, release)
    )
      continue;
    walkAst(shape.module.programNode, (node) => {
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "ThisExpression") && !isAstDescendant(node, shape.node))
        supported = false;
    });
    if (supported) return allocation.constructorName;
  }
  return null;
};
