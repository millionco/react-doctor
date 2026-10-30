import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getDownstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import {
  getUseStateDecl,
  isGenuineReactHookDeclarator,
  isState,
  isStateSetter,
} from "./effect/react.js";

interface UnresetNativeComponentStateInput {
  analysis: ProgramAnalysis;
  context: RuleContext;
  componentFunction: EsTreeNode;
  effectCall: EsTreeNode;
  resetSetterReferences: ReadonlyArray<Reference>;
}

const supportedProgramByNode = new WeakMap<EsTreeNode, boolean>();

const hasSupportedStateWitnessProgram = (context: RuleContext): boolean => {
  const program = context.scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return false;
  const cached = supportedProgramByNode.get(program);
  if (cached !== undefined) return cached;
  let isSupported = true;
  walkAst(program, (node) => {
    if (!isSupported) return false;
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const binding = context.scopes.symbolFor(node);
      if (
        binding &&
        binding.bindingIdentifier !== node &&
        [
          "React",
          "require",
          "module",
          "eval",
          "Function",
          "globalThis",
          "window",
          "self",
          "global",
        ].includes(node.name) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        isSupported = false;
        return false;
      }
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (isTypeOnlyImport(node)) return false;
      if (node.source.value === "node:module" || node.source.value === "module") {
        isSupported = false;
        return false;
      }
      if (
        node.source.value === "react" &&
        node.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
            (isNodeOfType(specifier, "ImportSpecifier") &&
              specifier.importKind !== "type" &&
              getImportedName(specifier) === "default"),
        )
      ) {
        isSupported = false;
      }
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    ) {
      return false;
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isProvenGlobalObjectReference(node, context.scopes) ||
      (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "constructor") ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor") ||
      (isNodeOfType(node, "Identifier") &&
        (node.name === "React" ||
          node.name === "require" ||
          node.name === "module" ||
          node.name === "eval" ||
          node.name === "Function") &&
        context.scopes.isGlobalReference(node))
    ) {
      isSupported = false;
      return false;
    }
  });
  supportedProgramByNode.set(program, isSupported);
  return isSupported;
};

const isDirectNativeStateDeclaration = (declaration: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    !isNodeOfType(declaration.init.callee, "Identifier")
  ) {
    return false;
  }
  const calleeSymbol = context.scopes.symbolFor(declaration.init.callee);
  if (
    !calleeSymbol ||
    !isNodeOfType(calleeSymbol.declarationNode, "ImportSpecifier") ||
    getImportedName(calleeSymbol.declarationNode) !== "useState" ||
    calleeSymbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  const importDeclaration = getValueImportDeclaration(calleeSymbol);
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.source.value === "react",
  );
};

export const hasUnresetNativeComponentState = ({
  analysis,
  context,
  componentFunction,
  effectCall,
  resetSetterReferences,
}: UnresetNativeComponentStateInput): boolean => {
  if (
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.body, "BlockStatement") ||
    !isNodeOfType(effectCall.parent, "ExpressionStatement") ||
    effectCall.parent.expression !== effectCall ||
    effectCall.parent.parent !== componentFunction.body ||
    !hasSupportedStateWitnessProgram(context)
  ) {
    return false;
  }
  const effectStatementIndex = componentFunction.body.body.findIndex(
    (statement) => statement === effectCall.parent,
  );
  if (effectStatementIndex < 0) return false;
  const precedingComponentStatements = new Set<EsTreeNode>(
    componentFunction.body.body.slice(0, effectStatementIndex),
  );
  const resetDeclarations = new Set<EsTreeNode>();
  for (const reference of resetSetterReferences) {
    const declaration = getUseStateDecl(analysis, reference);
    if (!declaration || findEnclosingFunction(declaration) !== componentFunction) return false;
    resetDeclarations.add(declaration);
  }
  for (const reference of getDownstreamRefs(analysis, componentFunction)) {
    if (!isState(analysis, reference) && !isStateSetter(analysis, reference)) continue;
    const declaration = getUseStateDecl(analysis, reference);
    if (
      !declaration ||
      resetDeclarations.has(declaration) ||
      findEnclosingFunction(declaration) !== componentFunction ||
      !isGenuineReactHookDeclarator(analysis, declaration, "useState") ||
      !isDirectNativeStateDeclaration(declaration, context)
    ) {
      continue;
    }
    const statement = declaration.parent;
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.parent !== componentFunction.body
    ) {
      continue;
    }
    if (precedingComponentStatements.has(statement)) return true;
  }
  return false;
};
