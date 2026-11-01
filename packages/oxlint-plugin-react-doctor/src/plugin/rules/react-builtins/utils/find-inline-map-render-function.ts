import type { SymbolDescriptor, ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../../utils/has-static-property-write-before.js";
import { isAllLiteralArrayExpression } from "../../../utils/is-all-literal-array-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasObservedInlineMapRefResult } from "./has-observed-inline-map-ref-result.js";
import {
  INLINE_MAP_ARGUMENT_COUNT,
  INLINE_MAP_ARRAY_STATIC_METHOD_NAMES,
  INLINE_MAP_FIRST_ARGUMENT_INDEX,
  INLINE_MAP_MINIMUM_ELEMENT_INDEX,
  INLINE_MAP_PROTOTYPE_METHOD_NAMES,
  INLINE_MAP_RUNTIME_TYPESCRIPT_NODES,
} from "./constants.js";

interface InlineMapRenderFunctionInput {
  allocation: EsTreeNodeOfType<"CallExpression">;
  filename: string | undefined;
  scopes: ScopeAnalysis;
}

const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();
const supportedReceivers = new WeakMap<SymbolDescriptor, boolean>();

export const findInlineMapRenderFunction = ({
  allocation,
  filename,
  scopes,
}: InlineMapRenderFunctionInput): EsTreeNode | null => {
  const callback = findEnclosingFunction(allocation);
  const returnedExpression = callback ? getSingleReturnExpression(callback) : null;
  if (
    !filename ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !returnedExpression ||
    stripParenExpression(returnedExpression) !== allocation
  )
    return null;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const mapCall = callbackRoot.parent;
  if (
    !isNodeOfType(mapCall, "CallExpression") ||
    mapCall.optional ||
    mapCall.arguments.length !== INLINE_MAP_ARGUMENT_COUNT ||
    mapCall.arguments[INLINE_MAP_FIRST_ARGUMENT_INDEX] !== callbackRoot ||
    !isNodeOfType(mapCall.callee, "MemberExpression") ||
    mapCall.callee.optional ||
    mapCall.callee.computed ||
    !isNodeOfType(mapCall.callee.property, "Identifier") ||
    mapCall.callee.property.name !== "map" ||
    !executesDuringRender(callback, scopes)
  )
    return null;
  const owner = findEnclosingFunction(mapCall);
  if (!owner || !hasObservedInlineMapRefResult({ mapCall, owner, filename, scopes })) return null;
  const receiver = stripParenExpression(mapCall.callee.object);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = scopes.symbolFor(receiver);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      (symbol.kind === "const" &&
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.range[1] > mapCall.range[0])
    )
      return null;
    let supportedReceiver = supportedReceivers.get(symbol);
    if (supportedReceiver === undefined) {
      const valueImport = getValueImportDeclaration(symbol);
      const isLocalArray = Boolean(
        symbol.kind === "const" &&
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.id === symbol.bindingIdentifier &&
        declaration.init &&
        !isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration") &&
        isAllLiteralArrayExpression(stripParenExpression(declaration.init)),
      );
      supportedReceiver = Boolean(
        (valueImport || isLocalArray) &&
        !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
        !hasPossibleStaticPropertyMutationOrEscape(receiver, "map", scopes),
      );
      if (supportedReceiver) {
        for (const reference of symbol.references) {
          if (isTypeScriptTypePosition(reference.identifier)) continue;
          const root = findTransparentExpressionRoot(reference.identifier);
          const member = root.parent;
          if (
            reference.flag !== "read" ||
            isWithinAssignmentTarget(reference.identifier) ||
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== root
          ) {
            supportedReceiver = false;
            break;
          }
          if (
            member.computed &&
            isNodeOfType(member.property, "Literal") &&
            typeof member.property.value === "number" &&
            Number.isSafeInteger(member.property.value) &&
            member.property.value >= INLINE_MAP_MINIMUM_ELEMENT_INDEX
          )
            continue;
          if (member.computed) {
            supportedReceiver = false;
            break;
          }
          const propertyName = getStaticPropertyName(member);
          if (propertyName === "length") continue;
          const call = findTransparentExpressionRoot(member).parent;
          if (
            propertyName !== "map" ||
            !isNodeOfType(call, "CallExpression") ||
            call.callee !== findTransparentExpressionRoot(member)
          ) {
            supportedReceiver = false;
            break;
          }
        }
      }
      supportedReceivers.set(symbol, supportedReceiver);
    }
    if (!supportedReceiver) return null;
  } else if (!isAllLiteralArrayExpression(receiver)) return null;
  let supportedProgram = supportedPrograms.get(scopes);
  if (supportedProgram === undefined) {
    supportedProgram = true;
    walkAst(scopes.rootScope.node, (node) => {
      if (!supportedProgram) return false;
      if (
        ("declare" in node && node.declare === true) ||
        node.type === "WithStatement" ||
        INLINE_MAP_RUNTIME_TYPESCRIPT_NODES.has(node.type)
      ) {
        supportedProgram = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "Identifier") && scopes.referenceFor(node)) {
        const symbol = scopes.symbolFor(node);
        if (
          symbol?.kind === "ts-interface" ||
          symbol?.kind === "ts-type-alias" ||
          (symbol?.kind === "import" && !getValueImportDeclaration(symbol)) ||
          (node.name === "eval" && scopes.isGlobalReference(node))
        ) {
          supportedProgram = false;
          return false;
        }
      }
      if (
        isProvenGlobalNamespaceReference(node, "eval", scopes) ||
        isProvenGlobalNamespaceReference(node, "Function", scopes)
      ) {
        supportedProgram = false;
        return false;
      }
      if (isProvenGlobalNamespaceReference(node, "Array", scopes)) {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (
          (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
          parent.callee === root
        )
          return;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === root &&
          INLINE_MAP_ARRAY_STATIC_METHOD_NAMES.has(getStaticPropertyName(parent) ?? "") &&
          isNodeOfType(parent.parent, "CallExpression") &&
          parent.parent.callee === parent
        )
          return;
        supportedProgram = false;
        return false;
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const propertyName = getStaticPropertyName(node);
        if (
          propertyName === "__proto__" ||
          (INLINE_MAP_PROTOTYPE_METHOD_NAMES.has(propertyName ?? "") &&
            (isProvenGlobalNamespaceReference(node.object, "Object", scopes) ||
              isProvenGlobalNamespaceReference(node.object, "Reflect", scopes)))
        ) {
          supportedProgram = false;
          return false;
        }
      }
    });
    supportedPrograms.set(scopes, supportedProgram);
  }
  return supportedProgram ? owner : null;
};
