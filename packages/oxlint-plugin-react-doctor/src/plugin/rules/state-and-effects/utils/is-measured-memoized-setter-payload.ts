import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getReactUseCallbackCall } from "../../../utils/get-react-use-callback-call.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { hasVisibleBindingNamed } from "../../../utils/has-visible-binding-named.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { statementAlwaysExits } from "../../../utils/statement-always-exits.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface BindingProperty {
  readonly name: string;
  readonly pattern: EsTreeNodeOfType<"ObjectPattern">;
}

const getBindingProperty = (symbol: SymbolDescriptor): BindingProperty | null => {
  const property = symbol.bindingIdentifier.parent;
  if (!isNodeOfType(property, "Property") || property.value !== symbol.bindingIdentifier)
    return null;
  if (!isNodeOfType(property.parent, "ObjectPattern")) return null;
  const name = getStaticPropertyKeyName(property);
  return name === null ? null : { name, pattern: property.parent };
};

const getOwnDataFields = (node: EsTreeNode): ReadonlyMap<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || fields.has(name)) return null;
    fields.set(name, property.value);
  }
  return fields;
};

const getReadOnlySymbol = (node: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  return symbol && symbol.references.every((reference) => reference.flag === "read")
    ? symbol
    : null;
};

const findTypeBinding = (name: EsTreeNodeOfType<"Identifier">, scopes: ScopeAnalysis) => {
  if (hasEnclosingTypeParameterNamed(name, name.name)) return null;
  for (
    let scope: ReturnType<ScopeAnalysis["scopeFor"]> | null = scopes.scopeFor(name);
    scope;
    scope = scope.parent
  ) {
    const symbol = scope.symbolsByName.get(name.name);
    if (symbol) return symbol;
  }
  return null;
};

const isReactNamedCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const symbol = getReadOnlySymbol(node.callee, scopes);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === name,
  );
};

const getTypeArguments = (node: EsTreeNode | null | undefined): ReadonlyArray<EsTreeNode> =>
  isNodeOfType(node, "TSTypeParameterInstantiation") ? node.params : [];

const DOM_TYPE_NAMES = new Set(["HTMLElement", "HTMLDivElement"]);
const typeOverridesByProgram = new WeakMap<EsTreeNode, boolean>();

const hasAmbientTypeOverrides = (program: EsTreeNode): boolean => {
  const cached = typeOverridesByProgram.get(program);
  if (cached !== undefined) return cached;
  let overrides = false;
  walkAst(program, (node) => {
    if (overrides) return false;
    if ((node.type as string) === "TSGlobalDeclaration") overrides = true;
    if (isNodeOfType(node, "TSModuleDeclaration")) {
      const name = getStaticKeyName(node.id);
      if (name === "react" || name === "global") overrides = true;
    }
  });
  typeOverridesByProgram.set(program, overrides);
  return overrides;
};

const isNullableDomType = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "TSUnionType") || node.types.length !== 2) return false;
  const target = node.types.find((part) => isNodeOfType(part, "TSTypeReference"));
  if (
    !isNodeOfType(target, "TSTypeReference") ||
    !isNodeOfType(target.typeName, "Identifier") ||
    target.typeArguments
  )
    return false;
  const name = target.typeName.name;
  return (
    DOM_TYPE_NAMES.has(name) &&
    !hasVisibleBindingNamed(target, name, scopes) &&
    !hasEnclosingTypeParameterNamed(target, name) &&
    node.types.some((part) => isNodeOfType(part, "TSNullKeyword"))
  );
};

const isDeclaredDomRefParameter = (
  symbol: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (symbol.kind !== "parameter") return false;
  const binding = getBindingProperty(symbol);
  if (!binding || binding.pattern.parent !== owner || !binding.pattern.typeAnnotation) return false;
  const type = binding.pattern.typeAnnotation.typeAnnotation;
  if (
    !isNodeOfType(type, "TSTypeReference") ||
    !isNodeOfType(type.typeName, "Identifier") ||
    type.typeArguments
  )
    return false;
  const declaration = findTypeBinding(type.typeName, scopes)?.declarationNode;
  const sameFileDeclarations = findSameFileTypeDeclarations(type, type.typeName.name);
  if (
    !isNodeOfType(declaration, "TSInterfaceDeclaration") ||
    declaration.typeParameters ||
    declaration.extends.length > 0 ||
    sameFileDeclarations.length !== 1 ||
    sameFileDeclarations[0] !== declaration
  )
    return false;
  const fields = declaration.body.body.filter(
    (field) =>
      isNodeOfType(field, "TSPropertySignature") &&
      !field.computed &&
      getStaticKeyName(field.key) === binding.name,
  );
  const field = fields[0];
  if (fields.length !== 1 || !isNodeOfType(field, "TSPropertySignature") || field.optional)
    return false;
  const refType = field.typeAnnotation?.typeAnnotation;
  if (!isNodeOfType(refType, "TSTypeReference") || !isNodeOfType(refType.typeName, "Identifier"))
    return false;
  const refTypeSymbol = findTypeBinding(refType.typeName, scopes);
  if (
    !refTypeSymbol ||
    getImportedName(refTypeSymbol.declarationNode) !== "MutableRefObject" ||
    getImportDeclarationForSymbol(refTypeSymbol)?.source.value !== "react"
  )
    return false;
  const argumentsList = getTypeArguments(refType.typeArguments);
  return argumentsList.length === 1 && isNullableDomType(argumentsList[0], scopes);
};

const isMountedRefAttribute = (identifier: EsTreeNode, owner: EsTreeNode): boolean => {
  const expression = identifier.parent;
  if (!isNodeOfType(expression, "JSXExpressionContainer")) return false;
  const attribute = expression.parent;
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "ref"
  )
    return false;
  const opening = attribute.parent;
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "div"
  )
    return false;
  const element = opening.parent;
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(element.parent, "ReturnStatement") ||
    findEnclosingFunction(element) !== owner
  )
    return false;
  return opening.attributes.every(
    (entry) =>
      isNodeOfType(entry, "JSXAttribute") &&
      (entry === attribute ||
        !isNodeOfType(entry.name, "JSXIdentifier") ||
        entry.name.name !== "ref"),
  );
};

const isRefSlot = (
  node: EsTreeNode | null | undefined,
  identifier: EsTreeNode,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  node.object === identifier &&
  getStaticPropertyKeyName(node) === "current";

const isKnownElementUse = (slot: EsTreeNode, allowStyleWrite: boolean): boolean => {
  const use = slot.parent;
  if (isNodeOfType(use, "UnaryExpression")) return use.operator === "!";
  if (!isNodeOfType(use, "MemberExpression") || use.object !== slot) return false;
  const property = getStaticPropertyKeyName(use);
  if (property === "clientWidth" || property === "clientHeight") {
    return !isWithinAssignmentTarget(use);
  }
  if (!allowStyleWrite || property !== "style") return false;
  // Writing through the native CSSStyleDeclaration leaves the DOM ref and
  // dimension accessors intact. The larger assignment target contains `slot`.
  const styleProperty = use.parent;
  if (
    !isNodeOfType(styleProperty, "MemberExpression") ||
    styleProperty.object !== use ||
    getStaticPropertyKeyName(styleProperty) === null
  ) {
    return false;
  }
  const assignment = styleProperty.parent;
  return (
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.left === styleProperty &&
    assignment.operator === "="
  );
};

const isLocalDomRef = (
  symbol: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const init = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(init, "CallExpression") ||
    findEnclosingFunction(init) !== owner ||
    !isReactNamedCall(init, "useRef", scopes)
  )
    return false;
  const typeArgs = getTypeArguments(init.typeArguments);
  const [initialValue] = init.arguments;
  if (
    typeArgs.length !== 1 ||
    !isNullableDomType(typeArgs[0], scopes) ||
    init.arguments.length !== 1 ||
    !isNodeOfType(initialValue, "Literal") ||
    initialValue.value !== null
  )
    return false;
  let mountCount = 0;
  const onlyKnownUses = symbol.references.every(({ identifier }) => {
    const parent = identifier.parent;
    if (isMountedRefAttribute(identifier, owner)) {
      mountCount += 1;
      return true;
    }
    if (isNodeOfType(parent, "ArrayExpression")) {
      const call = parent.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.arguments[1] === parent &&
        (isReactNamedCall(call, "useEffect", scopes) ||
          isReactNamedCall(call, "useLayoutEffect", scopes) ||
          isReactNamedCall(call, "useCallback", scopes))
      );
    }
    return isRefSlot(parent, identifier) && isKnownElementUse(parent, false);
  });
  return onlyKnownUses && mountCount === 1;
};

const isDomMeasurementRef = (
  symbol: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = findProgramRoot(owner);
  if (
    !program ||
    hasAmbientTypeOverrides(program) ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  if (!isDeclaredDomRefParameter(symbol, owner, scopes))
    return isLocalDomRef(symbol, owner, scopes);
  // The declared parameter may be used by another import under the same DOM
  // contract. Reject locally visible ref replacement, aliasing and mutation.
  return symbol.references.every(({ identifier }) => {
    const use = identifier.parent;
    if (isRefSlot(use, identifier)) return isKnownElementUse(use, true);
    if (isNodeOfType(use, "ArrayExpression")) {
      const call = use.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.arguments[1] === use &&
        (isReactNamedCall(call, "useEffect", scopes) ||
          isReactNamedCall(call, "useLayoutEffect", scopes) ||
          isReactNamedCall(call, "useCallback", scopes))
      );
    }
    if (!isNodeOfType(use, "CallExpression") || !isNodeOfType(use.callee, "Identifier"))
      return false;
    const callee = getReadOnlySymbol(use.callee, scopes);
    return Boolean(
      callee &&
      getValueImportSource(callee) &&
      use.arguments.some((argument) => argument === identifier),
    );
  });
};

const getLayoutRead = (value: EsTreeNode, scopes: ScopeAnalysis) => {
  if (
    !isNodeOfType(value, "LogicalExpression") ||
    value.operator !== "??" ||
    !isNodeOfType(value.right, "Literal") ||
    value.right.value !== 0 ||
    !isNodeOfType(value.left, "ChainExpression")
  ) {
    return null;
  }
  const member = value.left.expression;
  if (!isNodeOfType(member, "MemberExpression") || !member.optional) return null;
  const name = getStaticPropertyKeyName(member);
  if (name !== "clientWidth" && name !== "clientHeight") return null;
  const slot = member.object;
  if (!isNodeOfType(slot, "MemberExpression") || getStaticPropertyKeyName(slot) !== "current")
    return null;
  const ref = getReadOnlySymbol(slot.object, scopes);
  return ref ? { ref, property: name } : null;
};

const getCallbackReturnValues = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">,
): ReadonlyArray<EsTreeNode | null> => {
  if (!isNodeOfType(callback.body, "BlockStatement")) return [];
  if (!statementAlwaysExits(callback.body)) return [];
  let allowed = true;
  walkAst(callback.body, (node) => {
    if (
      node.type.endsWith("Statement") &&
      node.type !== "BlockStatement" &&
      node.type !== "IfStatement" &&
      node.type !== "ReturnStatement"
    )
      allowed = false;
    if (
      (isNodeOfType(node, "VariableDeclaration") && node.kind !== "const") ||
      isNodeOfType(node, "CallExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "TaggedTemplateExpression") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    )
      allowed = false;
    return allowed;
  });
  return allowed
    ? collectFunctionReturnStatements(callback).map((statement) => statement.argument ?? null)
    : [];
};

const getDestructuredSource = (symbol: SymbolDescriptor): EsTreeNode | null => {
  const property = getBindingProperty(symbol);
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !property ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== property.pattern
  )
    return null;
  return declaration.init;
};

const isKnownNonNumericValue = (node: EsTreeNode | null): boolean => {
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value !== "number" || !Number.isFinite(node.value);
  }
  return (
    isNodeOfType(node, "TemplateLiteral") ||
    isNodeOfType(node, "ObjectExpression") ||
    isNodeOfType(node, "ArrayExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ClassExpression") ||
    isNodeOfType(node, "NewExpression")
  );
};

const isCapturedRatioTerm = (
  term: EsTreeNode,
  dependencies: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(term, "Literal")) return !isKnownNonNumericValue(term);
  const symbol = getReadOnlySymbol(term, scopes);
  if (!symbol || isKnownNonNumericValue(getDirectConstInitializer(symbol))) return false;
  if (dependencies.has(symbol)) return true;
  // An inner destructure may read the same source/key as a captured outer
  // destructure that used an empty object as its nullish fallback.
  const binding = getBindingProperty(symbol);
  const source = getDestructuredSource(symbol);
  const sourceSymbol = source && getReadOnlySymbol(source, scopes);
  if (!binding || !sourceSymbol) return false;
  for (const dependency of dependencies) {
    if (getBindingProperty(dependency)?.name !== binding.name) continue;
    const initializer = getDestructuredSource(dependency);
    if (
      !isNodeOfType(initializer, "LogicalExpression") ||
      initializer.operator !== "??" ||
      !isNodeOfType(initializer.right, "ObjectExpression") ||
      initializer.right.properties.length !== 0
    )
      continue;
    if (getReadOnlySymbol(initializer.left, scopes) === sourceSymbol) return true;
  }
  return false;
};

const getMeasurementField = (
  value: EsTreeNode,
  callback: EsTreeNode,
  dependencies: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
) => {
  const isScaled = isNodeOfType(value, "BinaryExpression") && value.operator === "*";
  if (isScaled) {
    const ratio = value.right;
    if (
      !isNodeOfType(ratio, "BinaryExpression") ||
      ratio.operator !== "/" ||
      !isCapturedRatioTerm(ratio.left, dependencies, scopes) ||
      !isCapturedRatioTerm(ratio.right, dependencies, scopes)
    )
      return null;
  }
  const binding = getReadOnlySymbol(isScaled ? value.left : value, scopes);
  const init = binding && getDirectConstInitializer(binding);
  if (!init || findEnclosingFunction(init) !== callback) return null;
  const read = getLayoutRead(init, scopes);
  return read && dependencies.has(read.ref) ? { ...read, direct: !isScaled } : null;
};

export const isMeasuredMemoizedSetterPayload = (
  node: EsTreeNode,
  effect: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional || node.arguments.length !== 1)
    return false;
  const payload = getOwnDataFields(node.arguments[0]);
  if (!payload?.size) return false;
  const owner = findEnclosingFunction(effect);
  if (!owner || findEnclosingFunction(node) !== effect) return false;
  let measurementCall: EsTreeNode | null = null;
  const selectedFields: string[] = [];
  for (const value of payload.values()) {
    const symbol = getReadOnlySymbol(value, scopes);
    const field = symbol && getBindingProperty(symbol);
    const source = symbol && getDestructuredSource(symbol);
    if (
      !field ||
      !source ||
      source.range[0] >= node.range[0] ||
      findEnclosingFunction(source) !== effect ||
      (measurementCall && measurementCall !== source)
    )
      return false;
    measurementCall = source;
    selectedFields.push(field.name);
  }
  if (
    !isNodeOfType(measurementCall, "CallExpression") ||
    measurementCall.optional ||
    measurementCall.arguments.length !== 0
  )
    return false;
  const memoSymbol = getReadOnlySymbol(measurementCall.callee, scopes);
  const memo = getReactUseCallbackCall(measurementCall.callee, scopes);
  if (
    !memo ||
    !memoSymbol ||
    getDirectConstInitializer(memoSymbol) !== memo ||
    findEnclosingFunction(memo) !== owner ||
    !isReactNamedCall(memo, "useCallback", scopes) ||
    memo.arguments.length !== 2
  )
    return false;
  const [callback, deps] = memo.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(deps, "ArrayExpression")
  )
    return false;
  const dependencies = new Set<SymbolDescriptor>();
  for (const entry of deps.elements) {
    const symbol = entry && getReadOnlySymbol(entry, scopes);
    if (!symbol) return false;
    dependencies.add(symbol);
  }
  const returned = getCallbackReturnValues(callback);
  if (returned.length === 0) return false;
  let nativeRef: SymbolDescriptor | null = null;
  let sharedDirectFields: Map<string, string> | null = null;
  for (const value of returned) {
    const fields = value && getOwnDataFields(value);
    if (!fields) return false;
    const directFields = new Map<string, string>();
    for (const name of selectedFields) {
      const output = fields.get(name);
      const measurement = output && getMeasurementField(output, callback, dependencies, scopes);
      if (!measurement || (nativeRef && nativeRef !== measurement.ref)) return false;
      nativeRef = measurement.ref;
      if (measurement.direct) directFields.set(name, measurement.property);
    }
    if (sharedDirectFields) {
      for (const [name, property] of sharedDirectFields) {
        if (directFields.get(name) !== property) sharedDirectFields.delete(name);
      }
    } else {
      sharedDirectFields = directFields;
    }
    if (sharedDirectFields.size === 0) return false;
  }
  return nativeRef !== null && isDomMeasurementRef(nativeRef, owner, scopes);
};
