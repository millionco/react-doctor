import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const currentOf = (node: EsTreeNode): EsTreeNode | null => {
  const member = stripParenExpression(node);
  return isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    !member.computed &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === "current" &&
    isNodeOfType(member.object, "Identifier")
    ? member.object
    : null;
};

// A necessary syntactic subset of the loading rule's published-generation proof.
// This does not grant a diagnostic exemption or establish any provider identity.
export const hasPotentialSplitGenerationReactProof = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = false;
  walkAst(program, (node) => {
    if (candidate) return false;
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "Identifier") ||
      !node.init
    )
      return;
    const tokenDeclaration = node.parent;
    const block = tokenDeclaration?.parent;
    if (
      !isNodeOfType(tokenDeclaration, "VariableDeclaration") ||
      tokenDeclaration.kind !== "const" ||
      tokenDeclaration.declarations.length !== 1 ||
      !isNodeOfType(block, "BlockStatement")
    )
      return;
    const initializer = stripParenExpression(node.init);
    if (
      !isNodeOfType(initializer, "BinaryExpression") ||
      initializer.operator !== "+" ||
      !isNodeOfType(initializer.right, "Literal") ||
      initializer.right.value !== 1
    )
      return;
    const ref = currentOf(initializer.left);
    const symbol = ref && scopes.symbolFor(ref);
    const refInitializer = symbol?.initializer && stripParenExpression(symbol.initializer);
    if (
      symbol?.kind !== "const" ||
      !isNodeOfType(refInitializer, "CallExpression") ||
      refInitializer.optional ||
      !isNodeOfType(refInitializer.callee, "Identifier") ||
      refInitializer.arguments.length !== 1 ||
      !isNodeOfType(refInitializer.arguments[0], "Literal") ||
      refInitializer.arguments[0].value !== 0
    )
      return;
    const hook = scopes.symbolFor(refInitializer.callee);
    const specifier = hook?.declarationNode;
    const imported = hook && getImportDeclarationForSymbol(hook);
    if (
      !isNodeOfType(specifier, "ImportSpecifier") ||
      specifier.importKind === "type" ||
      !isNodeOfType(specifier.imported, "Identifier") ||
      specifier.imported.name !== "useRef" ||
      imported?.source.value !== "react" ||
      imported.importKind === "type"
    )
      return;
    const next = block.body[block.body.findIndex((entry) => entry === tokenDeclaration) + 1];
    const assignment =
      isNodeOfType(next, "ExpressionStatement") && stripParenExpression(next.expression);
    const writtenRef =
      assignment && isNodeOfType(assignment, "AssignmentExpression") && currentOf(assignment.left);
    const token = scopes.symbolFor(node.id);
    if (
      !assignment ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !writtenRef ||
      scopes.symbolFor(writtenRef) !== symbol ||
      scopes.symbolFor(stripParenExpression(assignment.right)) !== token ||
      !token
    )
      return;
    candidate = token.references.some(({ identifier }) => {
      const outer = findTransparentExpressionRoot(identifier);
      const equality = outer.parent;
      if (!isNodeOfType(equality, "BinaryExpression") || equality.operator !== "===") return false;
      const other = equality.left === outer ? equality.right : equality.left;
      const comparedRef = currentOf(other);
      return !!comparedRef && scopes.symbolFor(comparedRef) === symbol;
    });
  });
  return candidate;
};

export const hasPotentialSplitGenerationReactSource = (
  filename: string,
  sourceText: string,
): boolean => {
  if (!sourceText.includes("===") || !sourceText.includes("+")) return false;
  if (
    (!sourceText.includes("useRef") || !sourceText.includes("current")) &&
    !sourceText.includes("\\u")
  )
    return false;
  const program = parseSourceText({ filename, sourceText });
  return (
    !isNodeOfType(program, "Program") ||
    hasPotentialSplitGenerationReactProof(program, analyzeScopes(program))
  );
};
