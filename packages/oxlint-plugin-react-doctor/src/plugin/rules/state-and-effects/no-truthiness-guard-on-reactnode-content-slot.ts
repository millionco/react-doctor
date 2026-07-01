import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isJsxElementOrFragment } from "../../utils/is-jsx-element-or-fragment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This truthiness guard on a `React.ReactNode` content slot drops legit `0` and `''` values, so a caller passing `0` (a counter, price, or progress) renders nothing. Guard with a renderable-aware check instead, e.g. `isReactRenderable(v) = v != null && v !== false && v !== ''`.";

// A type node is `ReactNode` (`ReactNode` or `React.ReactNode`). The
// numeric/string members of that union are exactly what a truthiness
// guard silently drops.
const isReactNodeReference = (typeNode: EsTreeNode | null | undefined): boolean => {
  if (!typeNode || !isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (isNodeOfType(typeName, "Identifier")) return typeName.name === "ReactNode";
  if (isNodeOfType(typeName, "TSQualifiedName")) {
    return isNodeOfType(typeName.right, "Identifier") && typeName.right.name === "ReactNode";
  }
  return false;
};

const isNullOrUndefinedKeyword = (typeNode: EsTreeNode): boolean =>
  typeNode.type === "TSNullKeyword" || typeNode.type === "TSUndefinedKeyword";

// The declared type is exactly `ReactNode` (optionally unioned only with
// `null`/`undefined`). A union that widens or narrows to anything else
// (e.g. `ReactNode | string[]`, or a plain `string`) is deliberately not
// matched so the guard stays quiet where `0`/`''` carry no drop hazard.
const isExactlyReactNodeType = (typeNode: EsTreeNode | null | undefined): boolean => {
  if (!typeNode) return false;
  if (isNodeOfType(typeNode, "TSUnionType")) {
    let sawReactNode = false;
    for (const member of typeNode.types) {
      const memberNode = member as EsTreeNode;
      if (isNullOrUndefinedKeyword(memberNode)) continue;
      if (isReactNodeReference(memberNode)) {
        sawReactNode = true;
        continue;
      }
      return false;
    }
    return sawReactNode;
  }
  return isReactNodeReference(typeNode);
};

const unwrapTypeAnnotation = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  if (isNodeOfType(node, "TSTypeAnnotation")) return (node.typeAnnotation as EsTreeNode) ?? null;
  return null;
};

// The declared type node of a matching `TSPropertySignature`, or `null`
// when the member name does not match / has no annotation.
const matchingPropertySignatureType = (
  member: EsTreeNode,
  memberName: string,
): EsTreeNode | null => {
  if (!isNodeOfType(member, "TSPropertySignature")) return null;
  const key = member.key;
  if (!isNodeOfType(key, "Identifier") || key.name !== memberName) return null;
  return unwrapTypeAnnotation((member.typeAnnotation as EsTreeNode) ?? null);
};

// The declared type of a named member inside an object type literal or a
// same-file interface / type alias referenced by name.
const resolveMemberTypeFromTypeNode = (
  typeNode: EsTreeNode | null,
  memberName: string,
  programRoot: EsTreeNode,
): EsTreeNode | null => {
  if (!typeNode) return null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    for (const member of typeNode.members) {
      const memberNode = member as EsTreeNode;
      if (
        isNodeOfType(memberNode, "TSPropertySignature") &&
        isNodeOfType(memberNode.key, "Identifier") &&
        memberNode.key.name === memberName
      ) {
        return matchingPropertySignatureType(memberNode, memberName);
      }
    }
    return null;
  }
  if (isNodeOfType(typeNode, "TSTypeReference") && isNodeOfType(typeNode.typeName, "Identifier")) {
    return resolveMemberTypeFromNamedType(typeNode.typeName.name, memberName, programRoot);
  }
  return null;
};

const resolveMemberTypeFromNamedType = (
  typeName: string,
  memberName: string,
  programRoot: EsTreeNode,
): EsTreeNode | null => {
  let resolved: EsTreeNode | null = null;
  walkAst(programRoot, (node) => {
    if (resolved) return false;
    if (isNodeOfType(node, "TSInterfaceDeclaration") && node.id.name === typeName) {
      for (const member of node.body.body) {
        const memberNode = member as EsTreeNode;
        if (
          isNodeOfType(memberNode, "TSPropertySignature") &&
          isNodeOfType(memberNode.key, "Identifier") &&
          memberNode.key.name === memberName
        ) {
          resolved = matchingPropertySignatureType(memberNode, memberName);
          return false;
        }
      }
    }
    if (isNodeOfType(node, "TSTypeAliasDeclaration") && node.id.name === typeName) {
      resolved = resolveMemberTypeFromTypeNode(
        node.typeAnnotation as EsTreeNode,
        memberName,
        programRoot,
      );
      return false;
    }
  });
  return resolved;
};

// Resolves the physically-present declared type of a guarded operand.
// Only three shapes are supported (AST-only, no type checker): a
// destructured prop with an object-type/interface annotation, a plain
// typed parameter, and a locally annotated variable. Inferred types
// (e.g. a `getRenderPropValue()` result) are a documented v1 non-goal.
const operandIsDeclaredReactNode = (operand: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(operand, operand.name);
  if (!binding) return false;
  const bindingIdentifier = binding.bindingIdentifier;
  const programRoot = findProgramRoot(operand);
  if (!programRoot) return false;

  const bindingParent = bindingIdentifier.parent;
  if (
    bindingParent &&
    isNodeOfType(bindingParent, "Property") &&
    bindingParent.parent &&
    isNodeOfType(bindingParent.parent, "ObjectPattern")
  ) {
    const patternType = unwrapTypeAnnotation(
      (bindingParent.parent.typeAnnotation as EsTreeNode) ?? null,
    );
    const memberType = resolveMemberTypeFromTypeNode(patternType, operand.name, programRoot);
    return isExactlyReactNodeType(memberType);
  }

  if (isNodeOfType(bindingIdentifier, "Identifier") && bindingIdentifier.typeAnnotation) {
    return isExactlyReactNodeType(
      unwrapTypeAnnotation(bindingIdentifier.typeAnnotation as EsTreeNode),
    );
  }

  return false;
};

// Flags a bare truthiness guard (`if (!prop) return`, `{prop && <JSX/>}`,
// `prop ? <JSX/> : null`) on an operand whose declared static type is
// exactly `React.ReactNode`. `0` and `''` are valid renderable nodes, so
// the guard silently drops content the caller passed.
export const noTruthinessGuardOnReactnodeContentSlot = defineRule({
  id: "no-truthiness-guard-on-reactnode-content-slot",
  title: "Truthiness guard on a ReactNode content slot",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A truthiness guard on a `React.ReactNode` slot drops valid `0` and `''` content, rendering nothing when a caller passes them. Use a nullish/renderable-aware check (`v != null && v !== false && v !== ''`) instead of a bare truthiness test.",
  create: (context: RuleContext) => {
    const reportOnOperand = (operand: EsTreeNode, reportNode: EsTreeNode): void => {
      if (!isNodeOfType(operand, "Identifier")) return;
      if (!operandIsDeclaredReactNode(operand)) return;
      context.report({ node: reportNode, message: MESSAGE });
    };

    return {
      IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
        const test = node.test;
        if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return;
        const consequent = node.consequent;
        const returnsEarly = isNodeOfType(consequent, "ReturnStatement")
          ? true
          : isNodeOfType(consequent, "BlockStatement") &&
            consequent.body.some((statement) =>
              isNodeOfType(statement as EsTreeNode, "ReturnStatement"),
            );
        if (!returnsEarly) return;
        reportOnOperand(stripParenExpression(test.argument as EsTreeNode), node);
      },
      LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
        if (node.operator !== "&&") return;
        if (!isJsxElementOrFragment(stripParenExpression(node.right as EsTreeNode))) return;
        reportOnOperand(stripParenExpression(node.left as EsTreeNode), node);
      },
      ConditionalExpression(node: EsTreeNodeOfType<"ConditionalExpression">) {
        const consequent = stripParenExpression(node.consequent as EsTreeNode);
        const alternate = stripParenExpression(node.alternate as EsTreeNode);
        const consequentIsJsx = isJsxElementOrFragment(consequent);
        const alternateIsJsx = isJsxElementOrFragment(alternate);
        const consequentIsNull = isNodeOfType(consequent, "Literal") && consequent.value === null;
        const alternateIsNull = isNodeOfType(alternate, "Literal") && alternate.value === null;
        const isRenderPickBranch =
          (consequentIsJsx && alternateIsNull) || (alternateIsJsx && consequentIsNull);
        if (!isRenderPickBranch) return;
        reportOnOperand(stripParenExpression(node.test as EsTreeNode), node);
      },
    };
  },
});
