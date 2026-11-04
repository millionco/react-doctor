import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getRangeStart } from "./get-range-start.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface SynchronousRenderOwnerProof {
  isProvenRefMutation: (node: EsTreeNode) => boolean;
  isProvenComputedMember: (node: EsTreeNode) => boolean;
}

const opaqueRenderEnvironmentByProgram = new WeakMap<
  EsTreeNode,
  Map<SynchronousRenderOwnerProof | undefined, boolean>
>();
const opaqueEnvironmentIdentifiers = new Set([
  "eval",
  "Function",
  "Reflect",
  "Object",
  "globalThis",
  "global",
  "window",
  "self",
  "parent",
  "top",
  "frames",
  "process",
  "React",
]);
const opaqueEnvironmentProperties = new Set([
  "eval",
  "Function",
  "Reflect",
  "Object",
  "constructor",
  "prototype",
  "__proto__",
  "require",
  "createRequire",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "defineProperty",
  "defineProperties",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
  "runInThisContext",
  "runInNewContext",
  "runInContext",
  "compileFunction",
  "Script",
]);
const opaqueModuleSources = new Set(["react", "vm", "node:vm"]);

const ownersByContext = new WeakMap<
  RuleContext,
  Map<SynchronousRenderOwnerProof | undefined, WeakMap<EsTreeNode, EsTreeNode | null>>
>();

const hasOpaqueRenderEnvironment = (
  node: EsTreeNode,
  context: RuleContext,
  proof?: SynchronousRenderOwnerProof,
): boolean => {
  const program = findProgramRoot(node);
  if (!program) return true;
  const variants =
    opaqueRenderEnvironmentByProgram.get(program) ??
    new Map<SynchronousRenderOwnerProof | undefined, boolean>();
  const cached = variants.get(proof);
  if (cached !== undefined) return cached;
  let exposed = false;
  walkAst(program, (candidate) => {
    if (exposed) return false;
    if (
      isNodeOfType(candidate, "Identifier") &&
      opaqueEnvironmentIdentifiers.has(candidate.name) &&
      context.scopes.referenceFor(candidate)
    ) {
      exposed = true;
    } else if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern")
    ) {
      const propertyName = getStaticPropertyKeyName(candidate);
      exposed = propertyName === null || opaqueEnvironmentProperties.has(propertyName);
    } else if (isNodeOfType(candidate, "ImportDeclaration") && !isTypeOnlyImport(candidate)) {
      const moduleSource = candidate.source.value;
      exposed =
        moduleSource === "vm" ||
        moduleSource === "node:vm" ||
        (moduleSource === "react" &&
          candidate.specifiers.some(
            (specifier) =>
              isNodeOfType(specifier, "ImportDefaultSpecifier") ||
              isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
              (isNodeOfType(specifier, "ImportSpecifier") &&
                specifier.importKind !== "type" &&
                getImportedName(specifier) === "default"),
          )) ||
        ((moduleSource === "module" || moduleSource === "node:module") &&
          candidate.specifiers.some(
            (specifier) =>
              isNodeOfType(specifier, "ImportDefaultSpecifier") ||
              isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
              getImportedName(specifier) === "createRequire",
          ));
    } else if (isNodeOfType(candidate, "ImportExpression")) {
      exposed =
        !isNodeOfType(candidate.source, "Literal") ||
        (typeof candidate.source.value === "string" &&
          opaqueModuleSources.has(candidate.source.value));
    } else if (isNodeOfType(candidate, "MemberExpression")) {
      const propertyName = getStaticPropertyName(candidate);
      exposed =
        (propertyName === null && !proof?.isProvenComputedMember(candidate)) ||
        opaqueEnvironmentProperties.has(propertyName ?? "") ||
        (proof !== undefined && propertyName === "useRef");
    } else if (
      isNodeOfType(candidate, "Identifier") &&
      candidate.name === "require" &&
      context.scopes.referenceFor(candidate)
    ) {
      const reference = findTransparentExpressionRoot(candidate);
      const call = reference.parent;
      const moduleSource =
        isNodeOfType(call, "CallExpression") && call.callee === reference
          ? getGlobalRequireModuleSource(call, context.scopes)
          : null;
      exposed = moduleSource === null || opaqueModuleSources.has(moduleSource);
    } else if (
      isNodeOfType(candidate, "TSImportEqualsDeclaration") &&
      candidate.importKind !== "type" &&
      isNodeOfType(candidate.moduleReference, "TSExternalModuleReference")
    ) {
      const moduleSource = candidate.moduleReference.expression;
      exposed =
        !isNodeOfType(moduleSource, "Literal") ||
        (typeof moduleSource.value === "string" && opaqueModuleSources.has(moduleSource.value));
    }
    if (exposed) return false;
  });
  variants.set(proof, exposed);
  opaqueRenderEnvironmentByProgram.set(program, variants);
  return exposed;
};

const isSimpleParameter = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Identifier") ||
  (isNodeOfType(node, "ObjectPattern") &&
    node.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isNodeOfType(property.value, "Identifier"),
    ));

const isInitializedValue = (
  node: EsTreeNode,
  before: number,
  context: RuleContext,
  visitedBindings: ReadonlySet<number> = new Set(),
  remainingDepth = FUNCTION_RESOLUTION_MAX_DEPTH,
): boolean => {
  if (remainingDepth <= 0) return false;
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Literal") || isFunctionLike(value)) return true;
  if (isNodeOfType(value, "Identifier")) {
    const symbol = context.scopes.symbolFor(value);
    if (!symbol) return value.name === "undefined" && context.scopes.isGlobalReference(value);
    if (symbol.kind === "parameter") return isSimpleParameter(symbol.declarationNode);
    const declaration = symbol.declarationNode;
    const declarationStart = getRangeStart(declaration);
    return Boolean(
      symbol.kind === "const" &&
      !visitedBindings.has(symbol.id) &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      declaration.id === symbol.bindingIdentifier &&
      declarationStart !== null &&
      declarationStart < before &&
      symbol.initializer &&
      symbol.references.every((reference) => reference.flag === "read") &&
      isInitializedValue(
        symbol.initializer,
        declarationStart,
        context,
        new Set(visitedBindings).add(symbol.id),
        remainingDepth - 1,
      ),
    );
  }
  if (isNodeOfType(value, "ObjectExpression")) {
    return value.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        !property.method &&
        property.kind === "init" &&
        isInitializedValue(property.value, before, context, visitedBindings, remainingDepth - 1),
    );
  }
  if (isNodeOfType(value, "ArrayExpression")) {
    return value.elements.every(
      (element) =>
        !element ||
        (!isNodeOfType(element, "SpreadElement") &&
          isInitializedValue(element, before, context, visitedBindings, remainingDepth - 1)),
    );
  }
  const callee = isNodeOfType(value, "CallExpression") ? stripParenExpression(value.callee) : null;
  const symbol = isNodeOfType(callee, "Identifier") ? context.scopes.symbolFor(callee) : null;
  return (
    isNodeOfType(value, "CallExpression") &&
    !value.optional &&
    symbol?.kind === "import" &&
    getImportedName(symbol.declarationNode) === "useRef" &&
    getValueImportSource(symbol) === "react" &&
    value.arguments.every(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        isInitializedValue(argument, before, context, visitedBindings, remainingDepth - 1),
    )
  );
};

const hasStraightLineCaptures = (
  functionNode: EsTreeNode,
  before: number,
  context: RuleContext,
): boolean => {
  let valid = true;
  walkAst(functionNode, (node) => {
    if (!valid || (node !== functionNode && isFunctionLike(node))) return false;
    if (
      isNodeOfType(node, "IfStatement") ||
      isNodeOfType(node, "SwitchStatement") ||
      isNodeOfType(node, "TryStatement") ||
      isNodeOfType(node, "ThrowStatement") ||
      isNodeOfType(node, "WhileStatement") ||
      isNodeOfType(node, "DoWhileStatement") ||
      isNodeOfType(node, "ForStatement") ||
      isNodeOfType(node, "ForInStatement") ||
      isNodeOfType(node, "ForOfStatement") ||
      isNodeOfType(node, "WithStatement")
    ) {
      valid = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !context.scopes.referenceFor(node)) return;
    const symbol = context.scopes.symbolFor(node);
    const referenceStart = getRangeStart(node);
    const boundary =
      symbol && findEnclosingFunction(symbol.declarationNode) === functionNode
        ? referenceStart
        : before;
    if (boundary !== null && isInitializedValue(node, boundary, context)) return;
    valid = false;
    return false;
  });
  return valid;
};

const isInitializedRefMutation = (
  node: EsTreeNode,
  before: number,
  context: RuleContext,
  proof?: SynchronousRenderOwnerProof,
): boolean => {
  const expression = stripParenExpression(node);
  if (proof?.isProvenRefMutation(expression)) {
    return (
      !isNodeOfType(expression, "AssignmentExpression") ||
      expression.operator !== "=" ||
      isInitializedValue(expression.right, before, context)
    );
  }
  return (
    isNodeOfType(expression, "AssignmentExpression") &&
    expression.operator === "=" &&
    isNodeOfType(expression.left, "MemberExpression") &&
    Boolean(resolveReactRefSymbol(expression.left, context.scopes)) &&
    isInitializedValue(expression.left.object, before, context) &&
    isInitializedValue(expression.right, before, context)
  );
};

const hasInitializedPrefix = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
  proof?: SynchronousRenderOwnerProof,
): boolean => {
  let child = node;
  let parent = node.parent;
  while (parent && child !== functionNode) {
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (statement === child) break;
        if (isNodeOfType(statement, "EmptyStatement")) continue;
        const statementStart = getRangeStart(statement);
        if (
          isNodeOfType(statement, "ExpressionStatement") &&
          statementStart !== null &&
          isInitializedRefMutation(statement.expression, statementStart, context, proof)
        )
          continue;
        if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const")
          return false;
        for (const declaration of statement.declarations) {
          const declarationStart = getRangeStart(declaration);
          if (
            !isNodeOfType(declaration.id, "Identifier") ||
            !declaration.init ||
            declarationStart === null ||
            !isInitializedValue(declaration.init, declarationStart, context)
          )
            return false;
        }
      }
    } else if (
      parent !== functionNode &&
      !isNodeOfType(parent, "ExpressionStatement") &&
      !isNodeOfType(parent, "TSAsExpression") &&
      !isNodeOfType(parent, "TSNonNullExpression")
    )
      return false;
    child = parent;
    parent = parent.parent;
  }
  return child === functionNode;
};

export const findSynchronouslyCalledRenderOwner = (
  node: EsTreeNode,
  context: RuleContext,
  remainingDepth = FUNCTION_RESOLUTION_MAX_DEPTH,
  proof?: SynchronousRenderOwnerProof,
): EsTreeNode | null => {
  if (
    remainingDepth <= 0 ||
    hasOpaqueRenderEnvironment(node, context, proof) ||
    !isNodeReachableWithinFunction(node, context)
  )
    return null;
  const functionNode = findEnclosingFunction(node);
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    !functionNode.params.every(isSimpleParameter) ||
    !hasInitializedPrefix(node, functionNode, context, proof)
  )
    return null;
  const nodeStart = getRangeStart(node);
  if (
    nodeStart === null ||
    (isNodeOfType(node, "AssignmentExpression") &&
      (node.operator === "="
        ? !isInitializedValue(node.right, nodeStart, context)
        : !proof?.isProvenRefMutation(node))) ||
    (isNodeOfType(node, "CallExpression") &&
      !node.arguments.every(
        (argument) =>
          !isNodeOfType(argument, "SpreadElement") &&
          isInitializedValue(argument, nodeStart, context),
      ))
  )
    return null;
  if (componentOrHookDisplayNameForFunction(functionNode)) return functionNode;
  const executionRoot = findTransparentExpressionRoot(node);
  if (
    !isNodeOfType(executionRoot.parent, "ExpressionStatement") &&
    functionNode.body !== executionRoot
  )
    return null;
  const variants =
    ownersByContext.get(context) ??
    new Map<SynchronousRenderOwnerProof | undefined, WeakMap<EsTreeNode, EsTreeNode | null>>();
  let owners = variants.get(proof);
  if (!owners) {
    owners = new WeakMap();
    variants.set(proof, owners);
    ownersByContext.set(context, variants);
  }
  const cached = owners.get(functionNode);
  if (cached !== undefined) return cached;
  owners.set(functionNode, null);
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const declaration = functionRoot.parent;
  const declarationStart = declaration ? getRangeStart(declaration) : null;
  if (
    functionNode.params.length ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== functionRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declarationStart === null ||
    !hasStraightLineCaptures(functionNode, declarationStart, context)
  )
    return null;
  const symbol = context.scopes.symbolFor(declaration.id);
  if (!symbol || symbol.kind !== "const" || !symbol.references.length) return null;
  const calls: EsTreeNode[] = [];
  for (const reference of symbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    const callStart = call ? getRangeStart(call) : null;
    if (
      callStart === null ||
      callStart <= declarationStart ||
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== identifier ||
      call.optional ||
      call.arguments.length ||
      !isNodeOfType(findTransparentExpressionRoot(call).parent, "ExpressionStatement") ||
      !isNodeOfType(stripParenExpression(call.callee), "Identifier") ||
      resolveExactLocalFunction(call.callee, context.scopes) !== functionNode
    )
      return null;
    calls.push(call);
  }
  for (const call of calls) {
    const owner = findSynchronouslyCalledRenderOwner(call, context, remainingDepth - 1, proof);
    if (owner) {
      owners.set(functionNode, owner);
      return owner;
    }
  }
  return null;
};
