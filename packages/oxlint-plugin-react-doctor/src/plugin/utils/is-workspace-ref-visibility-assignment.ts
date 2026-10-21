import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasExactRefRelayReads } from "./has-exact-ref-relay-reads.js";
import { hasOrdinaryRefRelayRuntime } from "./has-ordinary-ref-relay-runtime.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNamedReactRefRelayCall } from "./is-named-react-ref-relay-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUnchangedNativeRefRelay } from "./is-unchanged-native-ref-relay.js";
import { resolveWorkspaceRefRelayExport } from "./resolve-workspace-ref-relay-export.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getOwnFunction = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
};

const isClosedHost = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const name = opening.name;
  if (!isNodeOfType(name, "JSXIdentifier")) return false;
  if (/^[a-z]/.test(name.name)) return true;
  const symbol = scopes.symbolFor(name);
  if (!symbol || symbol.kind !== "const" || !symbol.initializer) return false;
  if (!hasCompleteSymbolReferences(symbol, program, scopes)) return false;
  if (
    !getRuntimeSymbolReferences(symbol).every((reference) => {
      const parent = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === reference.identifier
      );
    })
  )
    return false;
  const isHostValue = (node: EsTreeNode): boolean => {
    const value = stripParenExpression(node);
    if (isNodeOfType(value, "Literal"))
      return typeof value.value === "string" && /^[a-z]/.test(value.value);
    return (
      isNodeOfType(value, "ConditionalExpression") &&
      isHostValue(value.consequent) &&
      isHostValue(value.alternate)
    );
  };
  return isHostValue(symbol.initializer);
};

const hasDirectImportedCalls = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  getRuntimeSymbolReferences(symbol).every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    return (
      reference.flag === "read" &&
      isNodeOfType(root.parent, "CallExpression") &&
      !root.parent.optional &&
      root.parent.callee === root
    );
  });

export const isWorkspaceRefVisibilityAssignment = (
  context: RuleContext,
  assignment: EsTreeNode,
  stateIdentifier: EsTreeNode,
  setterIdentifier: EsTreeNode,
): boolean => {
  try {
    const sourceText = context.sourceCode?.getText?.();
    if (
      !context.filename ||
      sourceText === undefined ||
      hasJsxRuntimePragma({
        program: context.scopes.rootScope.node,
        filename: context.filename,
        sourceText,
      })
    )
      return false;
    if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
      return false;
    if (
      !isNodeOfType(stateIdentifier, "Identifier") ||
      !isNodeOfType(setterIdentifier, "Identifier")
    )
      return false;
    const visibility = stripParenExpression(assignment.left);
    if (
      !isNodeOfType(visibility, "MemberExpression") ||
      visibility.computed ||
      visibility.optional ||
      !isNodeOfType(visibility.property, "Identifier") ||
      visibility.property.name !== "visibility"
    )
      return false;
    const style = stripParenExpression(visibility.object);
    if (
      !isNodeOfType(style, "MemberExpression") ||
      style.computed ||
      style.optional ||
      !isNodeOfType(style.property, "Identifier") ||
      style.property.name !== "style"
    )
      return false;
    const receiver = stripParenExpression(style.object);
    const scopes = context.scopes;
    const program = scopes.rootScope.node;
    const state = scopes.symbolFor(stateIdentifier);
    const setter = scopes.symbolFor(setterIdentifier);
    if (!state || !setter || scopes.symbolFor(receiver) !== state) return false;
    if (
      !hasCompleteSymbolReferences(state, program, scopes) ||
      !getRuntimeSymbolReferences(state).every((reference) => reference.flag === "read")
    )
      return false;
    const pattern = stateIdentifier.parent;
    if (!isNodeOfType(pattern, "ArrayPattern") || setterIdentifier.parent !== pattern) return false;
    const [valueBinding, setterBinding, ...otherBindings] = pattern.elements;
    if (
      valueBinding !== stateIdentifier ||
      setterBinding !== setterIdentifier ||
      otherBindings.length > 0
    )
      return false;
    const stateDeclaration = pattern.parent;
    if (
      !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
      stateDeclaration.id !== pattern ||
      !stateDeclaration.init
    )
      return false;
    const stateStatement = stateDeclaration.parent;
    if (!isNodeOfType(stateStatement, "VariableDeclaration") || stateStatement.kind !== "const")
      return false;
    const stateCall = stripParenExpression(stateDeclaration.init);
    if (
      !isNodeOfType(stateCall, "CallExpression") ||
      !isNamedReactRefRelayCall(stateCall, "useState", scopes)
    )
      return false;
    const [seed, ...otherSeeds] = stateCall.arguments;
    if (!isNodeOfType(seed, "Literal") || seed.value !== null || otherSeeds.length > 0)
      return false;
    if (!hasOrdinaryRefRelayRuntime(program, scopes)) return false;
    const [setterReference, ...otherSetterReferences] = getRuntimeSymbolReferences(setter);
    if (
      !setterReference ||
      otherSetterReferences.length > 0 ||
      !hasExactRefRelayReads(setter, [setterReference.identifier], program, scopes)
    )
      return false;
    const argument = findTransparentExpressionRoot(setterReference.identifier);
    const relayCall = argument.parent;
    if (
      !isNodeOfType(relayCall, "CallExpression") ||
      relayCall.optional ||
      !relayCall.arguments.some((value) => value === argument)
    )
      return false;
    if (relayCall.arguments.some((value) => isNodeOfType(value, "SpreadElement"))) return false;
    if (!isNodeOfType(relayCall.callee, "Identifier")) return false;
    const imported = scopes.symbolFor(relayCall.callee);
    if (
      !imported ||
      imported.kind !== "import" ||
      !hasDirectImportedCalls(imported, program, scopes)
    )
      return false;
    const declaration = relayCall.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== relayCall ||
      !isNodeOfType(declaration.id, "Identifier")
    )
      return false;
    const statement = declaration.parent;
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.parent !== stateStatement.parent
    )
      return false;
    const component = getOwnFunction(stateDeclaration);
    if (!component || getOwnFunction(relayCall) !== component) return false;
    const result = scopes.symbolFor(declaration.id);
    if (!result || result.kind !== "const") return false;
    const [resultReference, ...otherResultReferences] = getRuntimeSymbolReferences(result);
    if (
      !resultReference ||
      otherResultReferences.length > 0 ||
      !hasExactRefRelayReads(result, [resultReference.identifier], program, scopes)
    )
      return false;
    const expression = findTransparentExpressionRoot(resultReference.identifier).parent;
    if (!isNodeOfType(expression, "JSXExpressionContainer")) return false;
    const attribute = expression.parent;
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attribute.name.name !== "ref"
    )
      return false;
    const opening = attribute.parent;
    if (!isNodeOfType(opening, "JSXOpeningElement") || getOwnFunction(opening) !== component)
      return false;
    if (
      getAuthoritativeJsxAttribute(opening.attributes, "ref") !== attribute ||
      !isClosedHost(opening, program, scopes)
    )
      return false;
    const resolved = resolveWorkspaceRefRelayExport(context, imported);
    return resolved !== null && isUnchangedNativeRefRelay(resolved);
  } catch {
    return false;
  }
};
