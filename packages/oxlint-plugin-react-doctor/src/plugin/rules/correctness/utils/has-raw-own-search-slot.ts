import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isEarlyExitStatement } from "../../../utils/is-early-exit-statement.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPropertyNamePosition } from "../../../utils/is-property-name-position.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  OWN_SEARCH_SLOT_MAX_VISITED_NODES,
  OWN_SEARCH_SLOT_GLOBAL_NAMES,
  OWN_SEARCH_SLOT_REGEX_PROPERTIES,
  OWN_SEARCH_SLOT_VM_MODULE_NAMES,
} from "./own-search-slot/constants.js";

interface OwnSearchSlotOptions {
  argument: EsTreeNode;
  scopes: ScopeAnalysis;
  getPossibleStrings: (node: EsTreeNode | null | undefined) => ReadonlySet<string>;
  isSearchName: (name: string) => boolean;
  isLiteralReset: (node: EsTreeNode) => boolean;
  isRawArgument: (node: EsTreeNode) => boolean;
  isRawParameter: (identifier: EsTreeNodeOfType<"Identifier">, write: EsTreeNode) => boolean;
}

interface OwnSearchSlotWriter {
  method: EsTreeNodeOfType<"MethodDefinition">;
  parameterIndex: number;
}

const findInstanceMethod = (node: EsTreeNode): EsTreeNodeOfType<"MethodDefinition"> | null => {
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (isFunctionLike(ancestor) && !isNodeOfType(ancestor, "ArrowFunctionExpression")) {
      const parent = ancestor.parent;
      return parent &&
        isNodeOfType(parent, "MethodDefinition") &&
        parent.value === ancestor &&
        !parent.static &&
        parent.kind !== "constructor" &&
        !parent.computed
        ? parent
        : null;
    }
    if (isNodeOfType(ancestor, "ClassBody") || isNodeOfType(ancestor, "Program")) return null;
    ancestor = ancestor.parent;
  }
  return null;
};

const isMobxValueImport = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  return Boolean(
    specifier &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    declaration &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "mobx" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === name &&
    symbol?.references.every((reference) => reference.flag === "read"),
  );
};

const isMobxDecoration = (
  node: EsTreeNode,
  classSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isMobxValueImport(node.callee, "decorate", scopes))
    return false;
  const [target, entries] = node.arguments;
  return Boolean(
    target &&
    isNodeOfType(target, "Identifier") &&
    scopes.symbolFor(target) === classSymbol &&
    entries &&
    isNodeOfType(entries, "ObjectExpression") &&
    entries.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        property.kind === "init" &&
        !property.method &&
        isMobxValueImport(property.value, "observable", scopes),
    ),
  );
};

const hasUnsupportedProvider = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  getPossibleStrings: OwnSearchSlotOptions["getPossibleStrings"],
): boolean => {
  if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) return true;
  if (
    isNodeOfType(node, "ImportDeclaration") &&
    node.importKind !== "type" &&
    OWN_SEARCH_SLOT_VM_MODULE_NAMES.has(getStaticStringExpression(node.source) ?? "") &&
    (node.specifiers.length === 0 ||
      node.specifiers.some(
        (specifier) =>
          !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
      ))
  )
    return true;
  if (
    isNodeOfType(node, "Identifier") &&
    !isPropertyNamePosition(node) &&
    !isTypeScriptTypePosition(node) &&
    scopes.referenceFor(node)
  ) {
    if (
      node.name === "Object" ||
      node.name === "Reflect" ||
      node.name === "Function" ||
      node.name === "eval" ||
      node.name === "require"
    )
      return true;
    if (node.name === "RegExp" && isWithinAssignmentTarget(node)) return true;
    if (OWN_SEARCH_SLOT_GLOBAL_NAMES.has(node.name)) {
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (!parent || !isNodeOfType(parent, "MemberExpression") || parent.object !== root)
        return true;
      const property = getResolvedStaticPropertyName(parent, scopes);
      if (property === null || property === "eval" || property === "constructor") return true;
      if (property === "RegExp" && isWithinAssignmentTarget(parent)) return true;
    }
  }
  if (
    isNodeOfType(node, "MemberExpression") ||
    (isNodeOfType(node, "Property") && node.parent && isNodeOfType(node.parent, "ObjectPattern"))
  ) {
    const property = getResolvedStaticPropertyName(node, scopes);
    const propertyNames = new Set(
      node.computed
        ? getPossibleStrings(isNodeOfType(node, "MemberExpression") ? node.property : node.key)
        : [],
    );
    if (property !== null) propertyNames.add(property);
    if (
      propertyNames.has("constructor") ||
      propertyNames.has("eval") ||
      propertyNames.has("Function") ||
      propertyNames.has("getBuiltinModule")
    )
      return true;
    if (
      isNodeOfType(node, "MemberExpression") &&
      propertyNames.has("RegExp") &&
      isWithinAssignmentTarget(node)
    )
      return true;
    if (isNodeOfType(node, "Property") && property === null && node.computed) return true;
  }
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (
    ((isNodeOfType(callee, "Identifier") && callee.name === "require") ||
      (isNodeOfType(callee, "MemberExpression") &&
        getResolvedStaticPropertyName(callee, scopes) === "getBuiltinModule")) &&
    [...getPossibleStrings(node.arguments[0])].some((moduleName) =>
      OWN_SEARCH_SLOT_VM_MODULE_NAMES.has(moduleName),
    )
  )
    return true;
  if (isNodeOfType(callee, "Identifier"))
    return callee.name === "eval" || callee.name === "Function";
  return (
    isNodeOfType(callee, "MemberExpression") &&
    callee.computed &&
    getResolvedStaticPropertyName(callee, scopes) === null
  );
};

export const hasRawOwnSearchSlot = ({
  argument,
  scopes,
  getPossibleStrings,
  isSearchName,
  isLiteralReset,
  isRawArgument,
  isRawParameter,
}: OwnSearchSlotOptions): boolean => {
  const member = stripParenExpression(argument);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.object, "ThisExpression") ||
    !isNodeOfType(member.property, "Identifier") ||
    !isSearchName(member.property.name)
  )
    return false;
  const slotName = member.property.name;
  const reader = findInstanceMethod(member);
  const classNode = reader ? findEnclosingClass(reader) : null;
  if (!reader || reader.kind !== "method" || !classNode || classNode.superClass || !classNode.id)
    return false;
  const classSymbol = scopes.symbolFor(classNode.id);
  const program = findProgramRoot(classNode);
  if (!classSymbol || !program) return false;
  const nodes: EsTreeNode[] = [];
  if (
    someAst(program, (node) => {
      nodes.push(node);
      return nodes.length > OWN_SEARCH_SLOT_MAX_VISITED_NODES;
    })
  )
    return false;
  try {
    if (nodes.some((node) => hasUnsupportedProvider(node, scopes, getPossibleStrings)))
      return false;
  } catch {
    return false;
  }
  if (
    classNode.body.body.some(
      (element) =>
        isNodeOfType(element, "StaticBlock") ||
        (isNodeOfType(element, "MethodDefinition") && element.kind === "constructor") ||
        ("computed" in element && element.computed),
    )
  )
    return false;
  if (
    nodes.some((node) => isNodeOfType(node, "Decorator") && findEnclosingClass(node) === classNode)
  )
    return false;
  const declaredMethodNames = new Set<string>();
  for (const element of classNode.body.body) {
    if (!isNodeOfType(element, "MethodDefinition") || element.static || element.kind !== "method")
      continue;
    const name = getStaticPropertyKeyName(element);
    if (!name) return false;
    declaredMethodNames.add(name);
  }
  const matchingFields = classNode.body.body.filter(
    (element) => getStaticPropertyKeyName(element, { allowComputedString: true }) === slotName,
  );
  const field = matchingFields[0];
  if (
    matchingFields.length !== 1 ||
    !field ||
    !isNodeOfType(field, "PropertyDefinition") ||
    field.static ||
    field.computed ||
    !field.value ||
    !isNodeOfType(field.value, "Literal") ||
    typeof field.value.value !== "string" ||
    !isLiteralReset(field.value) ||
    field.optional ||
    (field.typeAnnotation && !isNodeOfType(field.typeAnnotation.typeAnnotation, "TSStringKeyword"))
  )
    return false;
  const instanceSymbols = new Set<number>();
  let exposed = Boolean(
    classNode.parent &&
    (isNodeOfType(classNode.parent, "ExportNamedDeclaration") ||
      isNodeOfType(classNode.parent, "ExportDefaultDeclaration")),
  );
  for (const reference of classSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const parent = root.parent;
    if (reference.flag !== "read") return false;
    if (parent && isNodeOfType(parent, "NewExpression") && parent.callee === root) {
      const declaration = parent.parent;
      if (
        declaration &&
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.init === parent &&
        isNodeOfType(declaration.id, "Identifier")
      ) {
        for (const symbol of getEquivalentSymbols(declaration.id, scopes))
          instanceSymbols.add(symbol.id);
      } else if (declaration && isNodeOfType(declaration, "ExportDefaultDeclaration"))
        exposed = true;
      else return false;
      continue;
    }
    if (
      parent &&
      (isNodeOfType(parent, "ExportSpecifier") || isNodeOfType(parent, "ExportDefaultDeclaration"))
    ) {
      exposed = true;
      continue;
    }
    if (parent && isMobxDecoration(parent, classSymbol, scopes)) {
      exposed = true;
      continue;
    }
    return false;
  }
  const isInstance = (node: EsTreeNode): boolean => {
    const inner = stripParenExpression(node);
    if (isNodeOfType(inner, "ThisExpression")) {
      const method = findInstanceMethod(inner);
      return Boolean(method && findEnclosingClass(method) === classNode);
    }
    if (isNodeOfType(inner, "Identifier")) {
      const symbol = scopes.symbolFor(inner);
      return Boolean(symbol && instanceSymbols.has(symbol.id));
    }
    return (
      isNodeOfType(inner, "NewExpression") &&
      isNodeOfType(inner.callee, "Identifier") &&
      scopes.symbolFor(inner.callee) === classSymbol
    );
  };
  for (const node of nodes) {
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (!symbol || !instanceSymbols.has(symbol.id) || node === symbol.bindingIdentifier) continue;
      const reference = scopes.referenceFor(node);
      if (!reference || reference.flag !== "read") return false;
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        parent &&
        (isNodeOfType(parent, "ExportDefaultDeclaration") ||
          isNodeOfType(parent, "ExportSpecifier"))
      ) {
        exposed = true;
        continue;
      }
      if (parent && isNodeOfType(parent, "MemberExpression") && parent.object === root) continue;
      if (
        parent &&
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = scopes.symbolFor(parent.id);
        if (alias && instanceSymbols.has(alias.id)) continue;
      }
      return false;
    }
    if (isNodeOfType(node, "ThisExpression") && findEnclosingClass(node) === classNode) {
      if (!isInstance(node)) return false;
      const parent = findTransparentExpressionRoot(node).parent;
      if (
        !parent ||
        !isNodeOfType(parent, "MemberExpression") ||
        stripParenExpression(parent.object) !== node
      )
        return false;
    }
  }
  const writers: OwnSearchSlotWriter[] = [];
  const selectedMethodNames = new Set<string>();
  const readerName = getStaticPropertyKeyName(reader);
  if (!readerName) return false;
  selectedMethodNames.add(readerName);
  for (const node of nodes) {
    if (!isNodeOfType(node, "MemberExpression") || !isInstance(node.object)) continue;
    const property = getResolvedStaticPropertyName(node, scopes);
    if (
      isWithinAssignmentTarget(node) &&
      (!isNodeOfType(stripParenExpression(node.object), "ThisExpression") ||
        property === null ||
        declaredMethodNames.has(property))
    )
      return false;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (findInstanceMethod(node) === reader) {
      if (node.computed) return false;
      if (
        parent &&
        (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
        parent.callee === root
      )
        return false;
      if (
        classNode.body.body.some(
          (element) =>
            isNodeOfType(element, "MethodDefinition") &&
            (element.kind === "get" || element.kind === "set") &&
            getResolvedStaticPropertyName(element, scopes) === property,
        )
      )
        return false;
    }
    if (
      parent &&
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
      parent.callee === root &&
      (!isNodeOfType(parent, "CallExpression") ||
        !property ||
        !declaredMethodNames.has(property) ||
        classNode.body.body.filter(
          (element) => getResolvedStaticPropertyName(element, scopes) === property,
        ).length !== 1)
    )
      return false;
    if (property !== slotName) continue;
    if (node.optional || node.computed) return false;
    const outer = findTransparentExpressionRoot(node).parent;
    if (
      outer &&
      isNodeOfType(outer, "MemberExpression") &&
      OWN_SEARCH_SLOT_REGEX_PROPERTIES.has(getResolvedStaticPropertyName(outer, scopes) ?? "")
    )
      return false;
    if (!isWithinAssignmentTarget(node)) continue;
    const assignment = node.parent;
    if (
      !assignment ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== node
    )
      return false;
    const method = findInstanceMethod(node);
    if (
      !isNodeOfType(node.object, "ThisExpression") ||
      !method ||
      findEnclosingClass(method) !== classNode ||
      method === reader
    )
      return false;
    if (method.kind !== "method") return false;
    if (isLiteralReset(assignment.right)) continue;
    const writerStatement = assignment.parent;
    const writerBody = method.value.body;
    if (
      !writerStatement ||
      !isNodeOfType(writerStatement, "ExpressionStatement") ||
      writerStatement.expression !== assignment ||
      !isNodeOfType(writerBody, "BlockStatement") ||
      writerStatement.parent !== writerBody ||
      writerBody.body.at(-1) !== writerStatement ||
      writerBody.body.some(
        (statement) => statement !== writerStatement && isEarlyExitStatement(statement),
      )
    )
      return false;
    const value = stripParenExpression(assignment.right);
    if (!isNodeOfType(value, "Identifier")) return false;
    const parameter = scopes.symbolFor(value);
    const binding = parameter?.bindingIdentifier;
    if (
      !parameter ||
      parameter.kind !== "parameter" ||
      parameter.scope.node !== method.value ||
      !binding ||
      !isNodeOfType(binding, "Identifier") ||
      binding.optional ||
      (binding.typeAnnotation &&
        !isNodeOfType(binding.typeAnnotation.typeAnnotation, "TSStringKeyword")) ||
      !method.value.params.some((candidate) => candidate === binding) ||
      parameter.references.some((reference) => reference.flag !== "read") ||
      !isRawParameter(value, assignment)
    )
      return false;
    const parameterIndex = method.value.params.findIndex(
      (candidate) => candidate === parameter.bindingIdentifier,
    );
    const methodName = getStaticPropertyKeyName(method);
    if (!methodName) return false;
    selectedMethodNames.add(methodName);
    writers.push({ method, parameterIndex });
  }
  if (writers.length === 0) return false;
  for (const name of selectedMethodNames) {
    if (
      classNode.body.body.filter(
        (element) => getResolvedStaticPropertyName(element, scopes) === name,
      ).length !== 1
    )
      return false;
  }
  for (const node of nodes) {
    if (!isNodeOfType(node, "MemberExpression") || !isInstance(node.object)) continue;
    const property = getResolvedStaticPropertyName(node, scopes);
    if (!property || !selectedMethodNames.has(property)) continue;
    const root = findTransparentExpressionRoot(node);
    const call = root.parent;
    if (
      node.optional ||
      node.computed ||
      !call ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== root
    )
      return false;
  }
  for (const writer of writers) {
    const name = getStaticPropertyKeyName(writer.method);
    let calls = 0;
    let onlyLiteralCalls = true;
    for (const node of nodes) {
      if (!isNodeOfType(node, "CallExpression")) continue;
      const callee = stripParenExpression(node.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        !isInstance(callee.object) ||
        getResolvedStaticPropertyName(callee, scopes) !== name
      )
        continue;
      const value = node.arguments[writer.parameterIndex];
      if (!value || isNodeOfType(value, "SpreadElement")) return false;
      const inner = stripParenExpression(value);
      if (!isLiteralReset(inner)) {
        if (!isNodeOfType(inner, "Identifier")) return false;
        const parameter = scopes.symbolFor(inner);
        const binding = parameter?.bindingIdentifier;
        if (
          !parameter ||
          parameter.kind !== "parameter" ||
          !binding ||
          !isNodeOfType(binding, "Identifier") ||
          binding.optional ||
          (binding.typeAnnotation &&
            !isNodeOfType(binding.typeAnnotation.typeAnnotation, "TSStringKeyword")) ||
          !isFunctionLike(parameter.scope.node) ||
          !parameter.scope.node.params.some((candidate) => candidate === binding) ||
          parameter.references.some((reference) => reference.flag !== "read") ||
          !isRawArgument(inner)
        )
          return false;
      }
      calls += 1;
      if (!isLiteralReset(inner)) onlyLiteralCalls = false;
    }
    if (!exposed && calls > 0 && onlyLiteralCalls) return false;
  }
  return true;
};
