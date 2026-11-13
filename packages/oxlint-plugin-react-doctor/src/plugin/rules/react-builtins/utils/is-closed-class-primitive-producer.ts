import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ClosedClassPrimitiveProducerInput {
  call: EsTreeNode;
  setStateCall: EsTreeNode;
  scopes: ScopeAnalysis;
  resolveClassMember: (classNode: EsTreeNode, memberName: string) => EsTreeNode | null;
}

const isDirectPropsField = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    expression.computed ||
    expression.optional ||
    !isNodeOfType(expression.property, "Identifier")
  )
    return false;
  const receiver = stripParenExpression(expression.object);
  return (
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    !receiver.optional &&
    getStaticPropertyName(receiver) === "props" &&
    isNodeOfType(stripParenExpression(receiver.object), "ThisExpression")
  );
};

const isReadonlyPrimitiveProjection = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  requiresReflexiveValue: boolean,
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) {
    return (
      !("regex" in expression) &&
      (expression.value === null ||
        typeof expression.value === "string" ||
        typeof expression.value === "boolean" ||
        (typeof expression.value === "number" && expression.value === expression.value))
    );
  }
  if (isNodeOfType(expression, "Identifier")) {
    return expression.name === "undefined" && scopes.isGlobalReference(expression);
  }
  if (isDirectPropsField(expression)) return !requiresReflexiveValue;
  if (isNodeOfType(expression, "UnaryExpression")) {
    if (expression.operator === "typeof") return isDirectPropsField(expression.argument);
    return (
      expression.operator === "!" &&
      isReadonlyPrimitiveProjection(expression.argument, scopes, false)
    );
  }
  if (isNodeOfType(expression, "BinaryExpression")) {
    return (
      (expression.operator === "===" || expression.operator === "!==") &&
      isReadonlyPrimitiveProjection(expression.left, scopes, false) &&
      isReadonlyPrimitiveProjection(expression.right, scopes, false)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      !requiresReflexiveValue &&
      (expression.operator === "&&" || expression.operator === "||") &&
      isReadonlyPrimitiveProjection(expression.left, scopes, false) &&
      isReadonlyPrimitiveProjection(expression.right, scopes, false)
    );
  }
  return (
    isNodeOfType(expression, "ConditionalExpression") &&
    isReadonlyPrimitiveProjection(expression.test, scopes, false) &&
    isReadonlyPrimitiveProjection(expression.consequent, scopes, requiresReflexiveValue) &&
    isReadonlyPrimitiveProjection(expression.alternate, scopes, requiresReflexiveValue)
  );
};

export const isClosedClassPrimitiveProducer = ({
  call,
  setStateCall,
  scopes,
  resolveClassMember,
}: ClosedClassPrimitiveProducerInput): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    !isNodeOfType(stripParenExpression(call.callee.object), "ThisExpression") ||
    !isNodeOfType(setStateCall, "CallExpression") ||
    setStateCall.arguments.length !== 1 ||
    findEnclosingFunction(call) !== findEnclosingFunction(setStateCall)
  )
    return false;
  const payload = setStateCall.arguments[0];
  if (
    !isNodeOfType(payload, "ObjectExpression") ||
    payload.properties.length !== 1 ||
    !isNodeOfType(payload.properties[0], "Property") ||
    payload.properties[0].computed ||
    payload.properties[0].method ||
    payload.properties[0].kind !== "init"
  )
    return false;
  const classNode = findEnclosingClass(setStateCall);
  const methodName = getStaticPropertyName(call.callee);
  if (
    !classNode ||
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !classNode.id ||
    !classNode.superClass ||
    classNode.decorators?.length ||
    !methodName ||
    findEnclosingClass(call) !== classNode
  )
    return false;
  const classMembers = classNode.body.body;
  if (
    classMembers.some((classMember) => {
      if (
        !isNodeOfType(classMember, "MethodDefinition") &&
        !isNodeOfType(classMember, "PropertyDefinition")
      )
        return true;
      const classMemberName = getStaticPropertyKeyName(classMember);
      return Boolean(
        classMember.static ||
        classMember.computed ||
        classMember.decorators?.length ||
        classMemberName === "props" ||
        classMemberName === "setState" ||
        classMemberName === "updater" ||
        (isNodeOfType(classMember, "MethodDefinition") && classMember.kind !== "method"),
      );
    })
  )
    return false;
  const producer = resolveClassMember(classNode, methodName);
  const members = classMembers.filter((member) => getStaticPropertyKeyName(member) === methodName);
  const member = members[0];
  if (
    members.length !== 1 ||
    !member ||
    (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
    member.static ||
    member.computed ||
    member.decorators?.length ||
    (isNodeOfType(member, "MethodDefinition") && member.kind !== "method") ||
    !producer ||
    !isFunctionLike(producer) ||
    producer.async ||
    producer.generator ||
    producer.params.length !== 0
  )
    return false;
  const returned = getSingleReturnExpression(producer);
  if (!returned || !isReadonlyPrimitiveProjection(returned, scopes, true)) return false;
  const superclass = stripParenExpression(classNode.superClass);
  const reactApi = resolveImportedApiReference(superclass, scopes);
  const reactIdentifier = isNodeOfType(superclass, "MemberExpression")
    ? stripParenExpression(superclass.object)
    : superclass;
  if (
    reactApi?.source !== "react" ||
    (reactApi.importedName !== "Component" && reactApi.importedName !== "PureComponent") ||
    !isNodeOfType(reactIdentifier, "Identifier")
  )
    return false;
  const reactSymbol = scopes.symbolFor(reactIdentifier);
  const classSymbol = scopes.symbolFor(classNode.id);
  const program = findProgramRoot(call);
  if (!reactSymbol || !classSymbol || !program) return false;
  let hasUncertainty = false;
  walkAst(program, (node) => {
    if (hasUncertainty) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      ((isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) &&
        node !== classNode) ||
      (isNodeOfType(node, "CallExpression") && node !== call && node !== setStateCall) ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TaggedTemplateExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") ||
      isNodeOfType(node, "JSXSpreadAttribute") ||
      (isNodeOfType(node, "JSXAttribute") &&
        isNodeOfType(node.name, "JSXIdentifier") &&
        node.name.name === "ref")
    ) {
      hasUncertainty = true;
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      if (reference?.resolvedSymbol === reactSymbol && node !== reactIdentifier) {
        hasUncertainty = true;
        return false;
      }
      if (reference?.resolvedSymbol === classSymbol) {
        const parent = node.parent;
        if (
          reference.flag !== "read" ||
          (!isNodeOfType(parent, "ExportDefaultDeclaration") &&
            !isNodeOfType(parent, "ExportSpecifier"))
        )
          hasUncertainty = true;
      }
    }
    if (isNodeOfType(node, "ThisExpression")) {
      const parent = node.parent;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        parent.computed ||
        parent.optional
      ) {
        hasUncertainty = true;
        return false;
      }
      const fieldName = getStaticPropertyName(parent);
      if (
        fieldName === "constructor" ||
        fieldName === "__proto__" ||
        fieldName === "updater" ||
        (fieldName === "setState" && parent !== setStateCall.callee) ||
        (fieldName === methodName &&
          (!isNodeOfType(parent.parent, "CallExpression") || parent.parent.callee !== parent)) ||
        ((fieldName === "props" || fieldName === "state") &&
          (!isNodeOfType(parent.parent, "MemberExpression") || parent.parent.object !== parent))
      )
        hasUncertainty = true;
    }
  });
  return !hasUncertainty;
};
