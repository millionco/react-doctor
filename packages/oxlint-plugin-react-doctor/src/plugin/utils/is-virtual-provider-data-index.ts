import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isOwnObjectEnumeration } from "./is-own-object-enumeration.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isNumericLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number";

const isNumericIndex = (symbol: SymbolDescriptor | null): boolean =>
  Boolean(
    symbol &&
    (symbol.kind === "var" || symbol.kind === "let") &&
    (symbol.initializer === null || isNumericLiteral(symbol.initializer)) &&
    symbol.references.every(({ flag, identifier }) => {
      if (flag === "read") return true;
      const operation = identifier.parent;
      return (
        (isNodeOfType(operation, "UpdateExpression") && operation.argument === identifier) ||
        (isNodeOfType(operation, "AssignmentExpression") &&
          operation.operator === "=" &&
          operation.left === identifier &&
          isNumericLiteral(operation.right))
      );
    }),
  );

const isProviderOwnKeyEnumeration = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isOwnObjectEnumeration(node, scopes)) return true;
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier"))
    return false;
  const factory = scopes.symbolFor(node.callee);
  const declaration = factory?.declarationNode;
  if (
    !factory ||
    !isNodeOfType(declaration, "FunctionDeclaration") ||
    declaration.async ||
    declaration.generator ||
    factory.references.some(({ flag }) => flag !== "read")
  )
    return false;
  const returned = declaration.body.body.at(-1);
  if (!isNodeOfType(returned, "ReturnStatement") || !isNodeOfType(returned.argument, "Identifier"))
    return false;
  const result = scopes.symbolFor(returned.argument);
  if (!result || !isOwnObjectEnumeration(result.initializer, scopes, "keys")) return false;
  const resultReads = result.references.filter(
    ({ identifier }) => identifier !== returned.argument,
  );
  if (resultReads.length === 0) return true;
  const push = resultReads.find(({ identifier }) => {
    const member = identifier.parent;
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.object === identifier &&
      getStaticPropertyKeyName(member) === "push"
    );
  })?.identifier.parent;
  const apply = push?.parent;
  const call = apply?.parent;
  if (
    resultReads.length !== 2 ||
    !isNodeOfType(apply, "MemberExpression") ||
    apply.object !== push ||
    getStaticPropertyKeyName(apply) !== "apply" ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== apply ||
    call.arguments.length !== 2 ||
    !resultReads.every(
      ({ flag, identifier }) =>
        flag === "read" && (identifier.parent === push || identifier === call.arguments[0]),
    )
  )
    return false;
  const input = call.arguments[1];
  if (!isNodeOfType(input, "Identifier")) return false;
  const symbols = scopes.symbolFor(input);
  if (!symbols || !isOwnObjectEnumeration(symbols.initializer, scopes)) return false;
  const writes = symbols.references.filter(({ flag }) => flag !== "read");
  if (writes.length === 0)
    return symbols.references.length === 1 && symbols.references[0]?.identifier === input;
  const write = writes[0]?.identifier;
  const assignment = write?.parent;
  if (
    writes.length !== 1 ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== write ||
    !isNodeOfType(assignment.right, "CallExpression") ||
    !isNodeOfType(assignment.right.callee, "MemberExpression")
  )
    return false;
  const filter = assignment.right.callee;
  return (
    isNodeOfType(filter.object, "Identifier") &&
    scopes.symbolFor(filter.object) === symbols &&
    getStaticPropertyKeyName(filter) === "filter" &&
    symbols.references.every(
      ({ identifier }) =>
        identifier === write || identifier === input || identifier === filter.object,
    )
  );
};

const hasOwnDataLoopGuard = (
  member: EsTreeNode,
  loop: EsTreeNodeOfType<"ForInStatement">,
  key: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const source = scopes.symbolFor(loop.right);
  if (!source) return false;
  let child = member;
  for (let parent = child.parent; parent && parent !== loop; parent = child.parent) {
    const condition =
      isNodeOfType(parent, "IfStatement") && parent.consequent === child
        ? parent.test
        : isNodeOfType(parent, "LogicalExpression") &&
            parent.operator === "&&" &&
            parent.right === child
          ? parent.left
          : null;
    if (
      isNodeOfType(condition, "CallExpression") &&
      condition.arguments.length === 2 &&
      isNodeOfType(condition.arguments[0], "Identifier") &&
      scopes.symbolFor(condition.arguments[0]) === source &&
      isNodeOfType(condition.arguments[1], "Identifier") &&
      scopes.symbolFor(condition.arguments[1]) === key &&
      isNodeOfType(condition.callee, "MemberExpression") &&
      getStaticPropertyKeyName(condition.callee) === "call" &&
      isNodeOfType(condition.callee.object, "MemberExpression") &&
      getStaticPropertyKeyName(condition.callee.object) === "hasOwnProperty"
    ) {
      const empty = stripParenExpression(condition.callee.object.object);
      if (isNodeOfType(empty, "ObjectExpression") && empty.properties.length === 0) return true;
    }
    child = parent;
  }
  return false;
};

const hasSameOwnKeyReceiver = (
  enumeration: EsTreeNode,
  receiver: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (isOwnObjectEnumeration(enumeration, scopes)) return true;
  if (!receiver || !isNodeOfType(enumeration, "CallExpression")) return false;
  const argument = enumeration.arguments[0];
  if (!argument) return false;
  if (scopes.symbolFor(argument) === receiver) return true;
  return (
    isNodeOfType(argument, "CallExpression") &&
    argument.arguments.length === 1 &&
    isNodeOfType(argument.callee, "Identifier") &&
    argument.callee.name === "Object" &&
    scopes.isGlobalReference(argument.callee) &&
    scopes.symbolFor(argument.arguments[0]) === receiver
  );
};

export const isVirtualProviderDataIndex = (
  member: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const key = member.property;
  if (!isNodeOfType(member.object, "Identifier")) return false;
  if (isNodeOfType(key, "MemberExpression")) {
    return (
      isNodeOfType(key.object, "Identifier") &&
      key.object.name === "Symbol" &&
      scopes.isGlobalReference(key.object) &&
      getStaticPropertyKeyName(key) === "toPrimitive" &&
      !isWithinAssignmentTarget(member)
    );
  }
  if (!isNodeOfType(key, "Identifier")) return false;
  const symbol = scopes.symbolFor(key);
  if (!symbol) return false;
  const receiver = scopes.symbolFor(member.object);
  if (symbol.kind === "parameter") {
    const owner = symbol.bindingIdentifier.parent;
    if (
      isWithinAssignmentTarget(member) &&
      receiver?.kind === "parameter" &&
      receiver.bindingIdentifier.parent === owner
    )
      return true;
    const call = owner?.parent;
    return (
      isNodeOfType(owner, "FunctionExpression") &&
      owner.params[0] === symbol.bindingIdentifier &&
      isNodeOfType(call, "CallExpression") &&
      call.arguments[0] === owner &&
      isNodeOfType(call.callee, "MemberExpression") &&
      getStaticPropertyKeyName(call.callee) === "forEach" &&
      isProviderOwnKeyEnumeration(call.callee.object, scopes) &&
      hasSameOwnKeyReceiver(call.callee.object, receiver, scopes) &&
      symbol.references.every(({ flag }) => flag === "read")
    );
  }
  if (symbol.kind !== "var" && symbol.kind !== "let") return false;
  const loop = symbol.declarationNode.parent?.parent;
  if (isNodeOfType(loop, "ForInStatement")) {
    return (
      Boolean(receiver) &&
      symbol.references.every(({ flag }) => flag === "read") &&
      hasOwnDataLoopGuard(member, loop, symbol, scopes) &&
      (isWithinAssignmentTarget(member) || scopes.symbolFor(loop.right) === receiver)
    );
  }
  if (isNumericIndex(symbol)) return true;
  if (symbol.initializer !== null) return false;
  const writes = symbol.references.filter(({ flag }) => flag !== "read");
  const assignment = writes[0]?.identifier.parent;
  if (
    writes.length !== 1 ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== writes[0]?.identifier ||
    !isNodeOfType(assignment.right, "MemberExpression") ||
    !assignment.right.computed ||
    !isNodeOfType(assignment.right.object, "Identifier") ||
    !isNodeOfType(assignment.right.property, "Identifier") ||
    !isNumericIndex(scopes.symbolFor(assignment.right.property))
  )
    return false;
  const symbols = scopes.symbolFor(assignment.right.object);
  return Boolean(
    symbols &&
    isOwnObjectEnumeration(symbols.initializer, scopes) &&
    symbols.references.every(({ flag }) => flag === "read"),
  );
};
