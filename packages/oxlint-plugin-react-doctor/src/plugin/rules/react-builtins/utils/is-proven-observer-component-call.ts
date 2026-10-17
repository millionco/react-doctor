import type { ControlFlowAnalysis } from "../../../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { functionContainsReactRenderOutput } from "../../../utils/function-contains-react-render-output.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OBSERVER_COMPONENT_ARGUMENT_COUNT,
  OBSERVER_MODULE_SOURCE,
  OBSERVER_UNSUPPORTED_GLOBAL_REFERENCE_NAMES,
} from "./constants.js";

const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();

export const isProvenObserverComponentCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean => {
  if (
    call.optional ||
    call.parent?.type === "ChainExpression" ||
    call.arguments.length !== OBSERVER_COMPONENT_ARGUMENT_COUNT ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const provider = scopes.symbolFor(call.callee);
  if (!provider || provider.kind !== "import") return false;
  const specifier = provider.declarationNode;
  const declaration = specifier.parent;
  if (
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    getImportedName(specifier) !== "observer" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    declaration.source.value !== OBSERVER_MODULE_SOURCE ||
    !provider.references.every((reference) => {
      const consumer = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isNodeOfType(consumer, "CallExpression") &&
        !consumer.optional &&
        consumer.parent?.type !== "ChainExpression" &&
        consumer.callee === reference.identifier
      );
    })
  )
    return false;
  const argument = call.arguments[0];
  if (
    (!isNodeOfType(argument, "ArrowFunctionExpression") &&
      !isNodeOfType(argument, "FunctionExpression")) ||
    argument.async ||
    argument.generator ||
    !functionContainsReactRenderOutput(argument, scopes, controlFlow)
  )
    return false;
  const returnedValues = isNodeOfType(argument.body, "BlockStatement")
    ? collectFunctionReturnStatements(argument).map((statement) => statement.argument)
    : [argument.body];
  if (
    !returnedValues.every((expression) => {
      if (!expression) return false;
      const value = stripParenExpression(expression);
      return (
        isNodeOfType(value, "JSXElement") ||
        isNodeOfType(value, "JSXFragment") ||
        (isNodeOfType(value, "Literal") &&
          value.value === null &&
          !("regex" in value) &&
          !("bigint" in value))
      );
    })
  )
    return false;
  const resultDeclaration = call.parent;
  if (
    !isNodeOfType(resultDeclaration, "VariableDeclarator") ||
    resultDeclaration.init !== call ||
    !isNodeOfType(resultDeclaration.id, "Identifier")
  )
    return false;
  const result = scopes.symbolFor(resultDeclaration.id);
  if (
    !result ||
    getDirectConstInitializer(result) !== call ||
    !result.references.every((reference) => {
      const identifier = reference.identifier;
      const consumer = identifier.parent;
      if (reference.flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
      if (
        (isNodeOfType(consumer, "JSXOpeningElement") ||
          isNodeOfType(consumer, "JSXClosingElement")) &&
        consumer.name === identifier
      )
        return true;
      if (isNodeOfType(consumer, "ExportDefaultDeclaration") && consumer.declaration === identifier)
        return true;
      return (
        isNodeOfType(consumer, "ExportSpecifier") &&
        consumer.local === identifier &&
        consumer.exportKind !== "type" &&
        isNodeOfType(consumer.parent, "ExportNamedDeclaration") &&
        !consumer.parent.source &&
        consumer.parent.exportKind !== "type"
      );
    })
  )
    return false;
  let isSupported = supportedPrograms.get(scopes);
  if (isSupported === undefined) {
    isSupported = true;
    walkAst(scopes.rootScope.node, (node) => {
      if (!isSupported) return false;
      if (
        node.type === "TSEnumDeclaration" ||
        node.type === "TSModuleDeclaration" ||
        node.type === "TSImportEqualsDeclaration" ||
        node.type === "TSExportAssignment" ||
        node.type === "TSParameterProperty" ||
        node.type === "Decorator" ||
        node.type === "WithStatement" ||
        node.type === "ImportExpression" ||
        (isNodeOfType(node, "Identifier") && node.name === "eval")
      ) {
        isSupported = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "ImportDeclaration")) {
        if (
          (node.source.value === "node:module" || node.source.value === "module") &&
          !isTypeOnlyImport(node)
        ) {
          isSupported = false;
          return false;
        }
        if (
          node.source.value === OBSERVER_MODULE_SOURCE &&
          (node !== declaration || node.specifiers.some((candidate) => candidate !== specifier))
        ) {
          isSupported = false;
          return false;
        }
      }
      if (isNodeOfType(node, "Identifier")) {
        const symbol = scopes.symbolFor(node);
        if (
          isProvenGlobalObjectReference(node, scopes) ||
          (OBSERVER_UNSUPPORTED_GLOBAL_REFERENCE_NAMES.has(node.name) &&
            symbol?.bindingIdentifier !== node &&
            (scopes.isGlobalReference(node) ||
              Boolean(
                symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol),
              )))
        ) {
          isSupported = false;
          return false;
        }
      }
    });
    supportedPrograms.set(scopes, isSupported);
  }
  return isSupported;
};
