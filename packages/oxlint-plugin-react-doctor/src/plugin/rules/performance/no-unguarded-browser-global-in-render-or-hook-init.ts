import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isDefaultImportFromModule } from "../../utils/find-import-source-for-name.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isAfterFalsyServerSnapshotEarlyReturn } from "../../utils/is-after-falsy-server-snapshot-early-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGatedByFalsyServerSnapshot } from "../../utils/is-gated-by-falsy-server-snapshot.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { readBrowserGlobalAvailability } from "../../utils/read-browser-global-availability.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

const BROWSER_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "matchMedia",
]);

const isInsideAvailabilityGuard = (
  node: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  let currentNode = node;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode) && !executesDuringRender(parentNode, context.scopes)) break;
    if (
      isNodeOfType(parentNode, "LogicalExpression") &&
      (parentNode.operator === "&&" || parentNode.operator === "||") &&
      parentNode.right === currentNode &&
      readBrowserGlobalAvailability(
        parentNode.left,
        browserGlobalName,
        context,
        parentNode.operator === "&&",
      ) === true
    ) {
      return true;
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      if (
        (parentNode.consequent === currentNode &&
          readBrowserGlobalAvailability(parentNode.test, browserGlobalName, context, true) ===
            true) ||
        (parentNode.alternate === currentNode &&
          readBrowserGlobalAvailability(parentNode.test, browserGlobalName, context, false) ===
            true)
      ) {
        return true;
      }
    }
    if (isNodeOfType(parentNode, "IfStatement")) {
      if (
        (parentNode.consequent === currentNode &&
          readBrowserGlobalAvailability(parentNode.test, browserGlobalName, context, true) ===
            true) ||
        (parentNode.alternate === currentNode &&
          readBrowserGlobalAvailability(parentNode.test, browserGlobalName, context, false) ===
            true)
      ) {
        return true;
      }
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};

const isAfterAvailabilityEarlyExit = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (
    !enclosingFunction ||
    (enclosingFunction !== componentOrHookNode &&
      !executesDuringRender(enclosingFunction, context.scopes)) ||
    !isFunctionLike(enclosingFunction) ||
    !isNodeOfType(enclosingFunction.body, "BlockStatement")
  ) {
    return false;
  }

  let currentNode: EsTreeNode = node;
  while (currentNode !== enclosingFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return false;
    if (isNodeOfType(parentNode, "BlockStatement")) {
      for (const statement of parentNode.body) {
        if (statement === currentNode) break;
        if (!isNodeOfType(statement, "IfStatement")) continue;
        if (
          readBrowserGlobalAvailability(statement.test, browserGlobalName, context, false) ===
            true &&
          statementAlwaysExits(statement.consequent)
        ) {
          return true;
        }
        if (
          readBrowserGlobalAvailability(statement.test, browserGlobalName, context, true) ===
            true &&
          statement.alternate &&
          statementAlwaysExits(statement.alternate)
        ) {
          return true;
        }
      }
    }
    currentNode = parentNode;
  }
  return false;
};

const isTypeofProbe = (node: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  const parentNode = expressionRoot.parent;
  return (
    isNodeOfType(parentNode, "UnaryExpression") &&
    parentNode.operator === "typeof" &&
    parentNode.argument === expressionRoot
  );
};

const resolveFunctionNode = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode)) {
    return symbol.declarationNode;
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isFunctionLike(initializer) ? initializer : null;
};

const dynamicOptionsDisableSsr = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const options = call.arguments[1] ? stripParenExpression(call.arguments[1]) : null;
  if (!options || !isNodeOfType(options, "ObjectExpression")) return false;
  let isSsrDisabled = false;
  for (const property of options.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      isSsrDisabled = false;
      continue;
    }
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null && property.computed) {
      isSsrDisabled = false;
      continue;
    }
    if (propertyName !== "ssr") continue;
    const value = stripParenExpression(property.value);
    isSsrDisabled = isNodeOfType(value, "Literal") && value.value === false;
  }
  return isSsrDisabled;
};

const getClientOnlyDynamicCall = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression")) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(callee);
  if (
    !symbol ||
    !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    !isDefaultImportFromModule(callee, callee.name, "next/dynamic") ||
    !dynamicOptionsDisableSsr(call)
  ) {
    return null;
  }
  return call;
};

const resolveClientOnlyDynamicTarget = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const call = getClientOnlyDynamicCall(expression, context);
  if (!call) return null;
  const loader = call.arguments[0] ? stripParenExpression(call.arguments[0]) : null;
  if (!loader || !isFunctionLike(loader) || loader.params.length > 0) return null;
  const returnedExpression = getSingleReturnExpression(loader);
  if (!returnedExpression) return null;
  const target = stripParenExpression(returnedExpression);
  if (!isNodeOfType(target, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(target);
  if (
    !symbol ||
    symbol.references.some(
      (reference) => reference.identifier !== target || reference.flag !== "read",
    )
  ) {
    return null;
  }
  return resolveFunctionNode(symbol);
};

const collectClientOnlyDynamicTargets = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): ReadonlySet<EsTreeNode> => {
  const targets = new Set<EsTreeNode>();
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ExportDefaultDeclaration")) continue;
    const declaration = stripParenExpression(statement.declaration);
    const directTarget = resolveClientOnlyDynamicTarget(declaration, context);
    if (directTarget) {
      targets.add(directTarget);
      continue;
    }
    if (!isNodeOfType(declaration, "Identifier")) continue;
    const symbol = context.scopes.symbolFor(declaration);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      continue;
    }
    const target = resolveClientOnlyDynamicTarget(symbol.initializer, context);
    if (target) targets.add(target);
  }
  return targets;
};

const moduleTerminatesDuringServerEvaluation = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): boolean =>
  program.body.some((statement) => {
    if (!isNodeOfType(statement, "IfStatement")) return false;
    if (
      readBrowserGlobalAvailability(statement.test, "window", context, true) === false &&
      statementAlwaysExits(statement.consequent)
    ) {
      return true;
    }
    return Boolean(
      statement.alternate &&
      readBrowserGlobalAvailability(statement.test, "window", context, false) === false &&
      statementAlwaysExits(statement.alternate),
    );
  });

export const noUnguardedBrowserGlobalInRenderOrHookInit = defineRule({
  id: "no-unguarded-browser-global-in-render-or-hook-init",
  title: "Browser global read during server render",
  severity: "error",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Move browser-only reads into an effect or event, guard them behind a client-only render path, or use useSyncExternalStore with a stable server snapshot.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return {};
    if (classifyReactNativeFileTarget(context) === "react-native") return {};
    let fileIsEmailTemplate = false;
    let moduleExitsOnServer = false;
    let clientOnlyDynamicTargets: ReadonlySet<EsTreeNode> = new Set();
    const reportedNodes = new Set<EsTreeNode>();

    const reportBrowserRead = (node: EsTreeNode, browserGlobalName: string): void => {
      if (reportedNodes.has(node) || isTypeofProbe(node)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!componentOrHookNode) return;
      if (fileIsEmailTemplate) return;
      if (moduleExitsOnServer || clientOnlyDynamicTargets.has(componentOrHookNode)) return;
      if (isGeneratedImageRenderContext(context, findEnclosingJsxOpeningElement(node) ?? node)) {
        return;
      }
      if (isGatedByFalsyInitialState(node, context.scopes)) return;
      if (isGatedByFalsyServerSnapshot(node, context.scopes, context.filename)) return;
      if (isAfterClientOnlyEarlyReturn(node, componentOrHookNode, context.scopes)) return;
      if (
        isAfterFalsyServerSnapshotEarlyReturn(
          node,
          componentOrHookNode,
          context.scopes,
          context.filename,
        )
      )
        return;
      if (isInsideAvailabilityGuard(node, browserGlobalName, context)) return;
      if (isAfterAvailabilityEarlyExit(node, componentOrHookNode, browserGlobalName, context))
        return;
      reportedNodes.add(node);
      context.report({
        node,
        message: `\`${browserGlobalName}\` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsEmailTemplate = hasEmailTemplateImport(node);
        moduleExitsOnServer = moduleTerminatesDuringServerEvaluation(node, context);
        clientOnlyDynamicTargets = collectClientOnlyDynamicTargets(node, context);
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        if (!BROWSER_GLOBAL_NAMES.has(node.name)) return;
        if (!context.scopes.isGlobalReference(node)) return;
        reportBrowserRead(node, node.name);
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (node.computed) return;
        const objectNode = stripParenExpression(node.object);
        if (
          !isNodeOfType(objectNode, "Identifier") ||
          objectNode.name !== "globalThis" ||
          !context.scopes.isGlobalReference(objectNode) ||
          !isNodeOfType(node.property, "Identifier") ||
          !BROWSER_GLOBAL_NAMES.has(node.property.name)
        ) {
          return;
        }
        reportBrowserRead(node, node.property.name);
      },
    };
  },
});
