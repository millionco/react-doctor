import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readSolidRuleSettings } from "../../utils/read-solid-rule-settings.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ReferenceDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";

type TrackedExpect = "function" | "called-function" | "expression";

interface TrackedScope {
  node: EsTreeNode;
  expect: TrackedExpect;
}

interface ReactiveVariable {
  symbol: SymbolDescriptor;
  declarationScope: EsTreeNode;
}

interface ScopeStackItem {
  node: EsTreeNode;
  trackedScopes: TrackedScope[];
  hasJsx: boolean;
  unnamedDerivedSignals: Set<EsTreeNode>;
}

interface ReactivitySettings {
  customReactiveFunctions?: ReadonlyArray<string>;
}

const PROPS_NAME_PATTERN = /[pP]rops/;

const ARITHMETIC_AND_COMPARISON_OPERATORS = new Set([
  "<",
  "<=",
  ">",
  ">=",
  "<<",
  ">>",
  ">>>",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "|",
  "^",
  "&",
  "in",
]);

const UNARY_COERCE_OPERATORS = new Set(["-", "+", "~"]);

const TRACKED_EFFECT_PRIMITIVES: ReadonlyArray<string> = [
  "createMemo",
  "children",
  "createEffect",
  "createRenderEffect",
  "createDeferred",
  "createComputed",
  "createSelector",
  "untrack",
  "mapArray",
  "indexArray",
  "observable",
];

const CALLED_FUNCTION_PRIMITIVES: ReadonlyArray<string> = ["onMount", "onCleanup", "onError"];

const BROWSER_TIMER_FUNCTIONS = new Set([
  "setInterval",
  "setTimeout",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

const SYNC_CALLBACK_ARRAY_METHODS =
  /^(?:forEach|map|flatMap|reduce|reduceRight|find|findIndex|filter|every|some)$/;

const isPropsByName = (name: string): boolean => PROPS_NAME_PATTERN.test(name);

const isProgramOrFunctionLike = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node && (node.type === "Program" || isFunctionLike(node)));

const findParent = (
  node: EsTreeNode,
  predicate: (ancestor: EsTreeNode) => boolean,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
};

const findInScope = (
  node: EsTreeNode,
  scopeNode: EsTreeNode,
  predicate: (candidate: EsTreeNode) => boolean,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === scopeNode) return predicate(node) ? current : null;
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
};

const ignoreTransparentWrappers = (node: EsTreeNode, upward = false): EsTreeNode => {
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression"
  ) {
    const next = upward ? node.parent : (node as { expression?: EsTreeNode }).expression;
    if (next) return ignoreTransparentWrappers(next as EsTreeNode, upward);
  }
  return node;
};

const getFunctionName = (node: EsTreeNode): string | null => {
  if (
    (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) &&
    node.id
  ) {
    return node.id.name;
  }
  if (node.parent?.type === "VariableDeclarator") {
    const declarator = node.parent as EsTreeNodeOfType<"VariableDeclarator">;
    if (isNodeOfType(declarator.id, "Identifier")) return declarator.id.name;
  }
  return null;
};

const isJsxElementOrFragment = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node && (node.type === "JSXElement" || node.type === "JSXFragment"));

const traceIdentifierToValue = (identifier: EsTreeNode, context: RuleContext): EsTreeNode => {
  let current = identifier;
  const visited = new Set<EsTreeNode>();
  while (isNodeOfType(current, "Identifier") && !visited.has(current)) {
    visited.add(current);
    const symbol = context.scopes.symbolFor(current);
    if (!symbol) break;
    if (!isNodeOfType(symbol.declarationNode, "VariableDeclarator")) break;
    const declarator = symbol.declarationNode;
    if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) break;
    if (symbol.kind !== "const") {
      const allReadsOnly = symbol.references.every(
        (reference) =>
          reference.flag === "read" || reference.identifier === symbol.bindingIdentifier,
      );
      if (!allReadsOnly) break;
    }
    current = declarator.init as EsTreeNode;
  }
  return current;
};

export const solidReactivity = defineRule<Rule>({
  id: "solid-reactivity",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Ensure reactive values (signals, memos, props) are used within tracked scopes (JSX, createEffect, event handlers) and signals are called as functions, so changes are properly tracked by Solid's reactivity system.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    const settings = readSolidRuleSettings<ReactivitySettings>(context.settings, "reactivity");
    const customReactiveFunctions = settings.customReactiveFunctions ?? [];

    const scopeStack: ScopeStackItem[] = [];
    const signalVariables: ReactiveVariable[] = [];
    const propsVariables: ReactiveVariable[] = [];
    const syncCallbacks = new Set<EsTreeNode>();

    const currentScope = (): ScopeStackItem => scopeStack[scopeStack.length - 1];
    const parentScope = (): ScopeStackItem | undefined => scopeStack[scopeStack.length - 2];

    const pushSignal = (symbol: SymbolDescriptor, declarationScope?: EsTreeNode): void => {
      const scope = declarationScope ?? currentScope().node;
      if (!signalVariables.some((existing) => existing.symbol === symbol)) {
        signalVariables.push({ symbol, declarationScope: scope });
      }
    };

    const pushProps = (symbol: SymbolDescriptor, declarationScope?: EsTreeNode): void => {
      const scope = declarationScope ?? currentScope().node;
      if (!propsVariables.some((existing) => existing.symbol === symbol)) {
        propsVariables.push({ symbol, declarationScope: scope });
      }
    };

    const isRefInCurrentScope = (reference: ReferenceDescriptor): boolean => {
      let parentFunction = findParent(reference.identifier, (ancestor) =>
        isProgramOrFunctionLike(ancestor),
      );
      while (
        parentFunction &&
        isFunctionLike(parentFunction) &&
        syncCallbacks.has(parentFunction)
      ) {
        parentFunction = findParent(parentFunction, (ancestor) =>
          isProgramOrFunctionLike(ancestor),
        );
      }
      return parentFunction === currentScope().node;
    };

    const matchTrackedScope = (trackedScope: TrackedScope, node: EsTreeNode): boolean => {
      switch (trackedScope.expect) {
        case "function":
        case "called-function":
          return node === trackedScope.node;
        case "expression":
          return Boolean(
            findInScope(node, currentScope().node, (candidate) => candidate === trackedScope.node),
          );
      }
    };

    const handleTrackedScopes = (identifier: EsTreeNode, declarationScope: EsTreeNode): void => {
      const currentScopeNode = currentScope().node;
      const isDirectlyTracked = currentScope().trackedScopes.find((trackedScope) =>
        matchTrackedScope(trackedScope, identifier),
      );
      if (isDirectlyTracked) return;

      const matchedExpression = currentScope().trackedScopes.find((trackedScope) =>
        matchTrackedScope({ ...trackedScope, expect: "expression" }, identifier),
      );

      if (declarationScope === currentScopeNode) {
        let outerMemberExpression: EsTreeNode | null = null;
        if (identifier.parent?.type === "MemberExpression") {
          outerMemberExpression = identifier.parent as EsTreeNode;
          while (outerMemberExpression?.parent?.type === "MemberExpression") {
            outerMemberExpression = outerMemberExpression.parent as EsTreeNode;
          }
        }
        const parentCallExpression =
          identifier.parent?.type === "CallExpression" ? (identifier.parent as EsTreeNode) : null;
        const reportNode = outerMemberExpression ?? parentCallExpression ?? identifier;
        const reportName = isNodeOfType(identifier, "Identifier") ? identifier.name : "value";

        context.report({
          node: reportNode,
          message: matchedExpression
            ? `The reactive variable '${reportName}' should be wrapped in a function for reactivity. This includes event handler bindings on native elements, which are not reactive like other JSX props.`
            : `The reactive variable '${reportName}' should be used within JSX, a tracked scope (like createEffect), or inside an event handler function, or else changes will be ignored.`,
        });
      } else {
        if (!parentScope() || !isFunctionLike(currentScopeNode)) return;
        const pushUnnamedDerived = (): void => {
          parentScope()!.unnamedDerivedSignals.add(currentScopeNode);
        };
        if (isNodeOfType(currentScopeNode, "FunctionDeclaration") && currentScopeNode.id) {
          const functionSymbol = context.scopes.symbolFor(currentScopeNode.id as EsTreeNode);
          if (functionSymbol) {
            pushSignal(functionSymbol, declarationScope);
          } else {
            pushUnnamedDerived();
          }
        } else if (currentScopeNode.parent?.type === "VariableDeclarator") {
          const declarator = currentScopeNode.parent as EsTreeNodeOfType<"VariableDeclarator">;
          if (isNodeOfType(declarator.id, "Identifier")) {
            const variableSymbol = context.scopes.symbolFor(declarator.id);
            if (variableSymbol) {
              pushSignal(variableSymbol, declarationScope);
            } else {
              pushUnnamedDerived();
            }
          } else {
            pushUnnamedDerived();
          }
        } else if (currentScopeNode.parent?.type === "Property") {
          // HACK: object method pattern — skip silently
        } else {
          pushUnnamedDerived();
        }
      }
    };

    const getReferencesInCurrentScope = (
      reactiveVariables: ReactiveVariable[],
    ): Array<{
      reference: ReferenceDescriptor;
      declarationScope: EsTreeNode;
    }> => {
      const result: Array<{
        reference: ReferenceDescriptor;
        declarationScope: EsTreeNode;
      }> = [];
      for (const reactiveVariable of reactiveVariables) {
        for (const reference of reactiveVariable.symbol.references) {
          if (reference.identifier === reactiveVariable.symbol.bindingIdentifier) continue;
          if (isRefInCurrentScope(reference)) {
            result.push({
              reference,
              declarationScope: reactiveVariable.declarationScope,
            });
          }
        }
      }
      return result;
    };

    const markPropsOnCondition = (
      node: EsTreeNode,
      condition: (propsParam: EsTreeNodeOfType<"Identifier">) => boolean,
    ): void => {
      if (!isFunctionLike(node)) return;
      const functionNode = node as
        | EsTreeNodeOfType<"ArrowFunctionExpression">
        | EsTreeNodeOfType<"FunctionExpression">
        | EsTreeNodeOfType<"FunctionDeclaration">;
      if (functionNode.params.length !== 1) return;
      const firstParam = functionNode.params[0];
      if (!isNodeOfType(firstParam, "Identifier")) return;
      if (node.parent?.type === "JSXExpressionContainer") return;
      if (node.parent?.type === "TemplateLiteral") return;
      if (!condition(firstParam)) return;
      const propsSymbol = context.scopes.symbolFor(firstParam);
      if (propsSymbol) pushProps(propsSymbol, node);
    };

    const onFunctionEnter = (node: EsTreeNode): void => {
      if (isFunctionLike(node) && syncCallbacks.has(node)) return;
      if (isFunctionLike(node)) {
        markPropsOnCondition(node, (propsParam) => isPropsByName(propsParam.name));
      }
      scopeStack.push({
        node,
        trackedScopes: [],
        hasJsx: false,
        unnamedDerivedSignals: new Set(),
      });
    };

    const onFunctionExit = (exitingNode: EsTreeNode): void => {
      if (isFunctionLike(exitingNode) && syncCallbacks.has(exitingNode)) return;

      if (isFunctionLike(exitingNode)) {
        markPropsOnCondition(exitingNode, (propsParam) => {
          if (!isPropsByName(propsParam.name) && currentScope().hasJsx) {
            const functionName = getFunctionName(exitingNode);
            if (functionName && !/^[a-z]/.test(functionName)) return true;
          }
          return false;
        });
      }

      for (const { reference, declarationScope } of getReferencesInCurrentScope(signalVariables)) {
        const identifier = reference.identifier;
        if (reference.flag === "write" || reference.flag === "read-write") {
          const identifierName = isNodeOfType(identifier, "Identifier") ? identifier.name : "value";
          context.report({
            node: identifier,
            message: `The reactive variable '${identifierName}' should not be reassigned or altered directly.`,
          });
        } else if (isNodeOfType(identifier, "Identifier")) {
          const reportBadSignal = (where: string): void => {
            context.report({
              node: identifier,
              message: `The reactive variable '${identifier.name}' should be called as a function when used in ${where}.`,
            });
          };

          if (
            identifier.parent?.type === "CallExpression" ||
            (identifier.parent?.type === "ArrayExpression" &&
              identifier.parent.parent?.type === "CallExpression")
          ) {
            handleTrackedScopes(identifier, declarationScope);
          } else if (identifier.parent?.type === "TemplateLiteral") {
            reportBadSignal("template literals");
          } else if (
            identifier.parent?.type === "BinaryExpression" &&
            ARITHMETIC_AND_COMPARISON_OPERATORS.has(
              (identifier.parent as EsTreeNodeOfType<"BinaryExpression">).operator,
            )
          ) {
            reportBadSignal("arithmetic or comparisons");
          } else if (
            identifier.parent?.type === "UnaryExpression" &&
            UNARY_COERCE_OPERATORS.has(
              (identifier.parent as EsTreeNodeOfType<"UnaryExpression">).operator,
            )
          ) {
            reportBadSignal("unary expressions");
          } else if (
            identifier.parent?.type === "MemberExpression" &&
            (identifier.parent as EsTreeNodeOfType<"MemberExpression">).computed &&
            (identifier.parent as EsTreeNodeOfType<"MemberExpression">).property === identifier
          ) {
            reportBadSignal("property accesses");
          } else if (identifier.parent?.type === "JSXExpressionContainer") {
            const isTrackedInScope = currentScope().trackedScopes.find(
              (trackedScope) =>
                trackedScope.node === identifier &&
                (trackedScope.expect === "function" || trackedScope.expect === "called-function"),
            );
            if (!isTrackedInScope) {
              const elementOrAttribute = identifier.parent.parent;
              if (
                isJsxElementOrFragment(elementOrAttribute) ||
                (elementOrAttribute?.type === "JSXAttribute" &&
                  elementOrAttribute.parent?.type === "JSXOpeningElement" &&
                  isNodeOfType(
                    (elementOrAttribute.parent as EsTreeNodeOfType<"JSXOpeningElement">).name,
                    "JSXIdentifier",
                  ) &&
                  isDomElementName(
                    (
                      (elementOrAttribute.parent as EsTreeNodeOfType<"JSXOpeningElement">)
                        .name as EsTreeNodeOfType<"JSXIdentifier">
                    ).name,
                  ))
              ) {
                reportBadSignal("JSX");
              }
            }
          }
        }
      }

      for (const { reference, declarationScope } of getReferencesInCurrentScope(propsVariables)) {
        const identifier = reference.identifier;
        if (reference.flag === "write" || reference.flag === "read-write") {
          const identifierName = isNodeOfType(identifier, "Identifier") ? identifier.name : "value";
          context.report({
            node: identifier,
            message: `The reactive variable '${identifierName}' should not be reassigned or altered directly.`,
          });
        } else if (
          identifier.parent?.type === "MemberExpression" &&
          (identifier.parent as EsTreeNodeOfType<"MemberExpression">).object === identifier
        ) {
          const memberExpression = identifier.parent as EsTreeNodeOfType<"MemberExpression">;
          if (
            memberExpression.parent?.type === "AssignmentExpression" &&
            (memberExpression.parent as EsTreeNodeOfType<"AssignmentExpression">).left ===
              memberExpression
          ) {
            const identifierName = isNodeOfType(identifier, "Identifier")
              ? identifier.name
              : "value";
            context.report({
              node: identifier,
              message: `The reactive variable '${identifierName}' should not be reassigned or altered directly.`,
            });
          } else if (
            isNodeOfType(memberExpression.property, "Identifier") &&
            /^(?:initial|default|static[A-Z])/.test(memberExpression.property.name)
          ) {
            // HACK: initial/default/static props are intentionally one-shot — skip
          } else {
            handleTrackedScopes(identifier, declarationScope);
          }
        } else if (
          identifier.parent?.type === "AssignmentExpression" ||
          identifier.parent?.type === "VariableDeclarator"
        ) {
          const identifierName = isNodeOfType(identifier, "Identifier") ? identifier.name : "value";
          context.report({
            node: identifier,
            message: `The reactive variable '${identifierName}' should be used within JSX, a tracked scope (like createEffect), or inside an event handler function, or else changes will be ignored.`,
          });
        }
      }

      const { unnamedDerivedSignals } = currentScope();
      for (const derivedNode of unnamedDerivedSignals) {
        if (
          !currentScope().trackedScopes.find((trackedScope) =>
            matchTrackedScope(trackedScope, derivedNode),
          )
        ) {
          context.report({
            node: derivedNode,
            message:
              "This function should be passed to a tracked scope (like createEffect) or an event handler because it contains reactivity, or else changes will be ignored.",
          });
        }
      }

      scopeStack.pop();
    };

    const pushTrackedScope = (node: EsTreeNode, expect: TrackedExpect): void => {
      if (scopeStack.length === 0) return;
      currentScope().trackedScopes.push({ node, expect });
      if (
        expect !== "called-function" &&
        isFunctionLike(node) &&
        (node as { async?: boolean }).async
      ) {
        context.report({
          node,
          message:
            "This tracked scope should not be async. Solid's reactivity only tracks synchronously.",
        });
      }
    };

    const permissivelyTrackNode = (node: EsTreeNode): void => {
      walkAst(node, (childNode) => {
        const traced = traceIdentifierToValue(childNode, context);
        if (
          isFunctionLike(traced) ||
          (isNodeOfType(traced, "Identifier") &&
            traced.parent?.type !== "MemberExpression" &&
            !(
              traced.parent?.type === "CallExpression" &&
              (traced.parent as EsTreeNodeOfType<"CallExpression">).callee === traced
            ))
        ) {
          pushTrackedScope(childNode, "called-function");
          return false;
        }
      });
    };

    const checkForTrackedScopes = (node: EsTreeNode): void => {
      if (scopeStack.length === 0) return;

      if (isNodeOfType(node, "JSXExpressionContainer")) {
        const parentAttribute =
          node.parent?.type === "JSXAttribute"
            ? (node.parent as EsTreeNodeOfType<"JSXAttribute">)
            : null;

        if (
          parentAttribute &&
          isNodeOfType(parentAttribute.name, "JSXIdentifier") &&
          parentAttribute.name.name.startsWith("on") &&
          parentAttribute.parent?.type === "JSXOpeningElement" &&
          isNodeOfType(
            (parentAttribute.parent as EsTreeNodeOfType<"JSXOpeningElement">).name,
            "JSXIdentifier",
          ) &&
          isDomElementName(
            (
              (parentAttribute.parent as EsTreeNodeOfType<"JSXOpeningElement">)
                .name as EsTreeNodeOfType<"JSXIdentifier">
            ).name,
          )
        ) {
          pushTrackedScope(node.expression as EsTreeNode, "called-function");
        } else if (
          parentAttribute &&
          parentAttribute.name.type === "JSXNamespacedName" &&
          (parentAttribute.name as EsTreeNodeOfType<"JSXNamespacedName">).namespace.name ===
            "use" &&
          isFunctionLike(node.expression as EsTreeNode)
        ) {
          pushTrackedScope(node.expression as EsTreeNode, "called-function");
        } else if (
          parentAttribute &&
          isNodeOfType(parentAttribute.name, "JSXIdentifier") &&
          parentAttribute.name.name === "ref" &&
          isFunctionLike(node.expression as EsTreeNode)
        ) {
          pushTrackedScope(node.expression as EsTreeNode, "called-function");
        } else if (
          isJsxElementOrFragment(node.parent) &&
          isFunctionLike(node.expression as EsTreeNode)
        ) {
          pushTrackedScope(node.expression as EsTreeNode, "function");
        } else {
          pushTrackedScope(node.expression as EsTreeNode, "expression");
        }
      } else if (isNodeOfType(node, "JSXSpreadAttribute")) {
        pushTrackedScope(node.argument as EsTreeNode, "expression");
      } else if (isNodeOfType(node, "CallExpression")) {
        if (isNodeOfType(node.callee, "Identifier")) {
          const calleeName = node.callee.name;
          const firstArgument = node.arguments[0] as EsTreeNode | undefined;
          const secondArgument = node.arguments[1] as EsTreeNode | undefined;

          if (
            importTracker.matchImport(TRACKED_EFFECT_PRIMITIVES, calleeName) ||
            (importTracker.matchImport(["createResource"], calleeName) &&
              node.arguments.length >= 2)
          ) {
            if (firstArgument) pushTrackedScope(firstArgument, "function");
          } else if (
            importTracker.matchImport(CALLED_FUNCTION_PRIMITIVES, calleeName) ||
            BROWSER_TIMER_FUNCTIONS.has(calleeName)
          ) {
            if (firstArgument) pushTrackedScope(firstArgument, "called-function");
          } else if (importTracker.matchImport(["on"], calleeName)) {
            if (firstArgument) {
              if (isNodeOfType(firstArgument, "ArrayExpression")) {
                for (const element of firstArgument.elements) {
                  if (element && element.type !== "SpreadElement") {
                    pushTrackedScope(element as EsTreeNode, "function");
                  }
                }
              } else {
                pushTrackedScope(firstArgument, "function");
              }
            }
            if (secondArgument) pushTrackedScope(secondArgument, "called-function");
          } else if (
            /^(?:use|create)[A-Z]/.test(calleeName) ||
            customReactiveFunctions.includes(calleeName)
          ) {
            for (const argument of node.arguments) {
              permissivelyTrackNode(argument as EsTreeNode);
            }
          }
        } else if (isNodeOfType(node.callee, "MemberExpression")) {
          const property = node.callee.property;
          if (isNodeOfType(property, "Identifier")) {
            if (property.name === "addEventListener" && node.arguments.length >= 2) {
              pushTrackedScope(node.arguments[1] as EsTreeNode, "called-function");
            } else if (
              /^(?:use|create)[A-Z]/.test(property.name) ||
              customReactiveFunctions.includes(property.name)
            ) {
              for (const argument of node.arguments) {
                permissivelyTrackNode(argument as EsTreeNode);
              }
            }
          }
        }
      } else if (isNodeOfType(node, "AssignmentExpression")) {
        if (
          isNodeOfType(node.left, "MemberExpression") &&
          isNodeOfType(node.left.property, "Identifier") &&
          isFunctionLike(node.right as EsTreeNode) &&
          /^on[a-z]+$/.test(node.left.property.name)
        ) {
          pushTrackedScope(node.right as EsTreeNode, "called-function");
        }
      }
    };

    const checkForSyncCallbacks = (node: EsTreeNodeOfType<"CallExpression">): void => {
      if (
        node.arguments.length === 1 &&
        isFunctionLike(node.arguments[0] as EsTreeNode) &&
        !(node.arguments[0] as { async?: boolean }).async
      ) {
        const singleArgument = node.arguments[0] as EsTreeNode;
        if (
          isNodeOfType(node.callee, "Identifier") &&
          importTracker.matchImport(["batch", "produce"], node.callee.name)
        ) {
          syncCallbacks.add(singleArgument);
        } else if (
          isNodeOfType(node.callee, "MemberExpression") &&
          !node.callee.computed &&
          node.callee.object.type !== "ObjectExpression" &&
          isNodeOfType(node.callee.property, "Identifier") &&
          SYNC_CALLBACK_ARRAY_METHODS.test(node.callee.property.name)
        ) {
          syncCallbacks.add(singleArgument);
        }
      }

      if (isNodeOfType(node.callee, "Identifier")) {
        if (importTracker.matchImport(["createSignal", "createStore"], node.callee.name)) {
          if (node.parent?.type === "VariableDeclarator") {
            const declarator = node.parent as EsTreeNodeOfType<"VariableDeclarator">;
            if (isNodeOfType(declarator.id, "ArrayPattern") && declarator.id.elements.length > 1) {
              const setterElement = declarator.id.elements[1];
              if (setterElement && isNodeOfType(setterElement as EsTreeNode, "Identifier")) {
                const setterSymbol = context.scopes.symbolFor(setterElement as EsTreeNode);
                if (setterSymbol) {
                  for (const reference of setterSymbol.references) {
                    if (
                      reference.identifier !== setterSymbol.bindingIdentifier &&
                      reference.flag === "read" &&
                      reference.identifier.parent?.type === "CallExpression" &&
                      (reference.identifier.parent as EsTreeNodeOfType<"CallExpression">).callee ===
                        reference.identifier
                    ) {
                      const callExpression = reference.identifier
                        .parent as EsTreeNodeOfType<"CallExpression">;
                      for (const argument of callExpression.arguments) {
                        if (
                          isFunctionLike(argument as EsTreeNode) &&
                          !(argument as { async?: boolean }).async
                        ) {
                          syncCallbacks.add(argument as EsTreeNode);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else if (importTracker.matchImport(["mapArray", "indexArray"], node.callee.name)) {
          const secondArgument = node.arguments[1] as EsTreeNode | undefined;
          if (secondArgument && isFunctionLike(secondArgument)) {
            syncCallbacks.add(secondArgument);
          }
        }
      }

      if (isFunctionLike(node.callee as EsTreeNode)) {
        syncCallbacks.add(node.callee as EsTreeNode);
      }
    };

    const resolveNthDestructuredSymbol = (
      pattern: EsTreeNode,
      index: number,
    ): SymbolDescriptor | null => {
      if (!isNodeOfType(pattern, "ArrayPattern")) return null;
      const element = pattern.elements[index];
      if (!element || !isNodeOfType(element as EsTreeNode, "Identifier")) return null;
      return context.scopes.symbolFor(element as EsTreeNode) ?? null;
    };

    const resolveReturnedSymbol = (identifier: EsTreeNode): SymbolDescriptor | null => {
      if (!isNodeOfType(identifier, "Identifier")) return null;
      return context.scopes.symbolFor(identifier) ?? null;
    };

    const checkForReactiveAssignment = (
      bindingPattern: EsTreeNode | null,
      initExpression: EsTreeNode,
    ): void => {
      if (scopeStack.length === 0) return;
      const init = ignoreTransparentWrappers(initExpression);
      if (!isNodeOfType(init, "CallExpression") || !isNodeOfType(init.callee, "Identifier")) return;

      const calleeName = init.callee.name;

      if (importTracker.matchImport(["createSignal", "useTransition"], calleeName)) {
        const signalSymbol = bindingPattern
          ? resolveNthDestructuredSymbol(bindingPattern, 0)
          : null;
        if (signalSymbol) pushSignal(signalSymbol, currentScope().node);
      } else if (importTracker.matchImport(["createMemo", "createSelector"], calleeName)) {
        const memoSymbol = bindingPattern ? resolveReturnedSymbol(bindingPattern) : null;
        if (memoSymbol) pushSignal(memoSymbol, currentScope().node);
      } else if (importTracker.matchImport(["createStore"], calleeName)) {
        const storeSymbol = bindingPattern ? resolveNthDestructuredSymbol(bindingPattern, 0) : null;
        if (storeSymbol) pushProps(storeSymbol, currentScope().node);
      } else if (importTracker.matchImport(["mergeProps"], calleeName)) {
        const mergedSymbol = bindingPattern ? resolveReturnedSymbol(bindingPattern) : null;
        if (mergedSymbol) pushProps(mergedSymbol, currentScope().node);
      } else if (importTracker.matchImport(["splitProps"], calleeName)) {
        if (bindingPattern && isNodeOfType(bindingPattern, "ArrayPattern")) {
          for (
            let elementIndex = 0;
            elementIndex < bindingPattern.elements.length;
            elementIndex++
          ) {
            const splitSymbol = resolveNthDestructuredSymbol(bindingPattern, elementIndex);
            if (splitSymbol) pushProps(splitSymbol, currentScope().node);
          }
        } else if (bindingPattern) {
          const splitSymbol = resolveReturnedSymbol(bindingPattern);
          if (splitSymbol) pushProps(splitSymbol, currentScope().node);
        }
      } else if (importTracker.matchImport(["createResource"], calleeName)) {
        const resourceSymbol = bindingPattern
          ? resolveNthDestructuredSymbol(bindingPattern, 0)
          : null;
        if (resourceSymbol) pushProps(resourceSymbol, currentScope().node);
      } else if (importTracker.matchImport(["createMutable"], calleeName)) {
        const mutableSymbol = bindingPattern ? resolveReturnedSymbol(bindingPattern) : null;
        if (mutableSymbol) pushProps(mutableSymbol, currentScope().node);
      } else if (importTracker.matchImport(["mapArray"], calleeName)) {
        const mapCallback = init.arguments[1] as EsTreeNode | undefined;
        if (mapCallback && isFunctionLike(mapCallback)) {
          const mapFunction = mapCallback as EsTreeNodeOfType<"ArrowFunctionExpression">;
          if (mapFunction.params.length >= 2) {
            const indexParam = mapFunction.params[1];
            if (isNodeOfType(indexParam, "Identifier")) {
              const indexSymbol = context.scopes.symbolFor(indexParam);
              if (indexSymbol) pushSignal(indexSymbol);
            }
          }
        }
      } else if (importTracker.matchImport(["indexArray"], calleeName)) {
        const indexCallback = init.arguments[1] as EsTreeNode | undefined;
        if (indexCallback && isFunctionLike(indexCallback)) {
          const indexFunction = indexCallback as EsTreeNodeOfType<"ArrowFunctionExpression">;
          if (indexFunction.params.length >= 1) {
            const valueParam = indexFunction.params[0];
            if (isNodeOfType(valueParam, "Identifier")) {
              const valueSymbol = context.scopes.symbolFor(valueParam);
              if (valueSymbol) pushSignal(valueSymbol);
            }
          }
        }
      }
    };

    const handleJsxChildFunction = (node: EsTreeNode): void => {
      if (
        !isFunctionLike(node) ||
        node.parent?.type !== "JSXExpressionContainer" ||
        node.parent.parent?.type !== "JSXElement"
      )
        return;
      if (scopeStack.length === 0) return;

      const element = node.parent.parent as EsTreeNodeOfType<"JSXElement">;
      if (!isNodeOfType(element.openingElement.name, "JSXIdentifier")) return;
      const tagName = (element.openingElement.name as EsTreeNodeOfType<"JSXIdentifier">).name;
      const functionNode = node as
        | EsTreeNodeOfType<"ArrowFunctionExpression">
        | EsTreeNodeOfType<"FunctionExpression">;

      if (importTracker.matchImport(["For"], tagName) && functionNode.params.length >= 2) {
        const indexParam = functionNode.params[1];
        if (isNodeOfType(indexParam, "Identifier")) {
          const indexSymbol = context.scopes.symbolFor(indexParam);
          if (indexSymbol) pushSignal(indexSymbol, currentScope().node);
        }
      } else if (importTracker.matchImport(["Index"], tagName) && functionNode.params.length >= 1) {
        const itemParam = functionNode.params[0];
        if (isNodeOfType(itemParam, "Identifier")) {
          const itemSymbol = context.scopes.symbolFor(itemParam);
          if (itemSymbol) pushSignal(itemSymbol, currentScope().node);
        }
      }
    };

    const processNode = (node: EsTreeNode): void => {
      switch (node.type) {
        case "JSXExpressionContainer":
        case "JSXSpreadAttribute":
        case "AssignmentExpression":
          checkForTrackedScopes(node);
          break;
        case "CallExpression":
          checkForTrackedScopes(node);
          checkForSyncCallbacks(node as EsTreeNodeOfType<"CallExpression">);
          {
            const parentNode = node.parent
              ? ignoreTransparentWrappers(node.parent as EsTreeNode, true)
              : null;
            if (
              parentNode &&
              parentNode.type !== "AssignmentExpression" &&
              parentNode.type !== "VariableDeclarator"
            ) {
              checkForReactiveAssignment(null, node);
            }
          }
          break;
        case "VariableDeclarator": {
          const declarator = node as EsTreeNodeOfType<"VariableDeclarator">;
          if (declarator.init) {
            checkForReactiveAssignment(declarator.id as EsTreeNode, declarator.init as EsTreeNode);
            checkForTrackedScopes(node);
          }
          break;
        }
        case "JSXElement":
        case "JSXFragment":
          if (scopeStack.length > 0) currentScope().hasJsx = true;
          break;
      }
      if (
        node.type === "AssignmentExpression" &&
        !isNodeOfType((node as EsTreeNodeOfType<"AssignmentExpression">).left, "MemberExpression")
      ) {
        const assignmentNode = node as EsTreeNodeOfType<"AssignmentExpression">;
        checkForReactiveAssignment(
          assignmentNode.left as EsTreeNode,
          assignmentNode.right as EsTreeNode,
        );
      }
    };

    const depthFirstWalk = (node: EsTreeNode): void => {
      const isFunction = isFunctionLike(node);
      const isProgram = node.type === "Program";

      if (isFunction) {
        handleJsxChildFunction(node);
      }

      if (isFunction || isProgram) {
        onFunctionEnter(node);
      }

      processNode(node);

      const nodeRecord = node as unknown as Record<string, unknown>;
      for (const key of Object.keys(nodeRecord)) {
        if (key === "parent") continue;
        const child = nodeRecord[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (
              item &&
              typeof item === "object" &&
              typeof (item as { type?: string }).type === "string"
            ) {
              depthFirstWalk(item as EsTreeNode);
            }
          }
        } else if (
          child &&
          typeof child === "object" &&
          typeof (child as { type?: string }).type === "string"
        ) {
          depthFirstWalk(child as EsTreeNode);
        }
      }

      if (isFunction || isProgram) {
        onFunctionExit(node);
      }
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      "Program:exit"(programNode: EsTreeNode) {
        depthFirstWalk(programNode);
      },
    };
  },
});
