import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface TypedDisplayNameAssignmentOptions {
  node: EsTreeNodeOfType<"CallExpression">;
  scopes: ScopeAnalysis;
}

interface TypedDisplayNameProgramFacts {
  nextStatements: ReadonlyMap<EsTreeNode, EsTreeNode>;
  hasVisibleEval: boolean;
}

const programFactsByScopes = new WeakMap<ScopeAnalysis, TypedDisplayNameProgramFacts>();

const getTypedDisplayNameProgramFacts = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): TypedDisplayNameProgramFacts => {
  const cached = programFactsByScopes.get(scopes);
  if (cached) return cached;
  const nextStatements = new Map<EsTreeNode, EsTreeNode>();
  let previousStatement: EsTreeNode | null = null;
  for (const statement of program.body) {
    if (previousStatement && !nextStatements.has(previousStatement))
      nextStatements.set(previousStatement, statement);
    previousStatement = statement;
  }
  const facts: TypedDisplayNameProgramFacts = {
    nextStatements,
    hasVisibleEval: someAst(program, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return false;
      const callee = stripParenExpression(child.callee);
      if (isNodeOfType(callee, "Identifier")) return callee.name === "eval";
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "eval")
        return false;
      const receiver = stripParenExpression(callee.object);
      return (
        isNodeOfType(receiver, "Identifier") &&
        (receiver.name === "globalThis" || receiver.name === "window")
      );
    }),
  };
  programFactsByScopes.set(scopes, facts);
  return facts;
};

export const hasTypedDisplayNameAssignment = ({
  node,
  scopes,
}: TypedDisplayNameAssignmentOptions): boolean => {
  if (node.optional) return false;
  const initializerRoot = findTransparentExpressionRoot(node);
  const declarator = initializerRoot.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== initializerRoot ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const declaration = declarator.parent;
  if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const")
    return false;
  const [onlyDeclarator, ...otherDeclarators] = declaration.declarations;
  if (onlyDeclarator !== declarator || otherDeclarators.length) return false;
  const statement = isNodeOfType(declaration.parent, "ExportNamedDeclaration")
    ? declaration.parent
    : declaration;
  const program = statement.parent;
  if (!isNodeOfType(program, "Program")) return false;
  const symbol = scopes.symbolFor(declarator.id);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.scope !== scopes.rootScope ||
    scopes.rootScope.node !== program ||
    symbol.declarationNode !== declarator ||
    symbol.bindingIdentifier !== declarator.id ||
    symbol.initializer !== initializerRoot
  )
    return false;
  const programFacts = getTypedDisplayNameProgramFacts(program, scopes);
  const nextStatement = programFacts.nextStatements.get(statement);
  if (!isNodeOfType(nextStatement, "ExpressionStatement")) return false;
  const assignment = nextStatement.expression;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    assignment.left.optional ||
    !isNodeOfType(assignment.right, "Literal") ||
    typeof assignment.right.value !== "string" ||
    !assignment.right.value.trim()
  )
    return false;
  const member = assignment.left;
  if (
    (member.computed && !isNodeOfType(member.property, "Literal")) ||
    getStaticPropertyName(member) !== "displayName"
  )
    return false;
  const receiverRoot = member.object;
  const receiver = stripParenExpression(receiverRoot);
  if (!isNodeOfType(receiver, "Identifier") || scopes.symbolFor(receiver)?.id !== symbol.id)
    return false;
  for (const boundary of [
    { root: initializerRoot, leaf: node },
    { root: receiverRoot, leaf: receiver },
  ]) {
    let expression = boundary.root;
    while (expression !== boundary.leaf) {
      const wrapperType: string = expression.type;
      if (
        wrapperType !== "ParenthesizedExpression" &&
        wrapperType !== "TSAsExpression" &&
        wrapperType !== "TSTypeAssertion" &&
        wrapperType !== "TSSatisfiesExpression" &&
        wrapperType !== "TSNonNullExpression"
      )
        return false;
      if (!("expression" in expression) || !isAstNode(expression.expression)) return false;
      expression = expression.expression;
    }
  }
  const receiverReference = scopes.referenceFor(receiver);
  return (
    receiverReference?.resolvedSymbol?.id === symbol.id &&
    receiverReference.flag === "read" &&
    symbol.references.every(
      (reference) => reference.identifier === receiver && reference.flag === "read",
    ) &&
    !programFacts.hasVisibleEval
  );
};
