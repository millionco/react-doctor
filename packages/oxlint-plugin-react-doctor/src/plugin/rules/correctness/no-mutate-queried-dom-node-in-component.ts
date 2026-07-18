import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import {
  getImportedNameFromModule,
  isDefaultImportFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const DOM_QUERY_METHODS = new Set(["getElementById", "querySelector", "querySelectorAll"]);
const CLASS_LIST_MUTATION_METHODS = new Set(["add", "remove", "toggle", "replace"]);
// App-shell / third-party roots are never a component's own reconciled subtree.
const EXCLUDED_QUERY_TOKENS = new Set(["root", "__next"]);

// Per-element facts that decide whether React can actually clobber an
// imperative mutation. React only rewrites an attribute it diffs to a NEW
// value, so the mutated surface must be driven by a dynamic prop on the
// matched element: a node with no `style` prop (or an all-literal one)
// keeps an imperative `style.x` write forever, and a static `className`
// string is never re-applied over a `classList.add`. A `ref` on the
// element means the component deliberately manages it imperatively, so
// query-based writes to it are part of that sanctioned pattern.
interface OwnedStyleAttributeInfo {
  hasDynamicValue: boolean;
  knownPropertyNames: Set<string> | null;
}

interface OwnedElementInfo {
  hasRefAttribute: boolean;
  styleAttribute: OwnedStyleAttributeInfo | null;
  hasDynamicClassName: boolean;
}

interface OwnedTokens {
  ids: Map<string, OwnedElementInfo[]>;
  classNames: Map<string, OwnedElementInfo[]>;
  testIds: Map<string, OwnedElementInfo[]>;
}

interface ClassNameAttributeInfo {
  tokens: string[];
  isDynamic: boolean;
}

interface QueryTarget {
  kind: "id" | "class" | "testid";
  value: string;
}

const literalStringFromJsxAttributeValue = (
  value: EsTreeNode | null | undefined,
): string | null => {
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

const isStaticLiteralExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "Literal")) return true;
  return isNodeOfType(stripped, "TemplateLiteral") && stripped.expressions.length === 0;
};

const styleAttributeInfoFromValue = (
  value: EsTreeNode | null | undefined,
): OwnedStyleAttributeInfo => {
  if (!value || isNodeOfType(value, "Literal")) {
    return { hasDynamicValue: false, knownPropertyNames: null };
  }
  if (!isNodeOfType(value, "JSXExpressionContainer")) {
    return { hasDynamicValue: true, knownPropertyNames: null };
  }
  const expression = stripParenExpression(value.expression);
  if (!isNodeOfType(expression, "ObjectExpression")) {
    return { hasDynamicValue: true, knownPropertyNames: null };
  }
  let hasDynamicValue = false;
  let knownPropertyNames: Set<string> | null = new Set<string>();
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) {
      hasDynamicValue = true;
      knownPropertyNames = null;
      continue;
    }
    if (isNodeOfType(property.key, "Identifier")) {
      knownPropertyNames?.add(property.key.name);
    } else if (isNodeOfType(property.key, "Literal")) {
      knownPropertyNames?.add(String(property.key.value));
    } else {
      knownPropertyNames = null;
    }
    if (!isStaticLiteralExpression(property.value)) hasDynamicValue = true;
  }
  return { hasDynamicValue, knownPropertyNames };
};

const classNameAttributeInfoFromValue = (
  value: EsTreeNode | null | undefined,
): ClassNameAttributeInfo => {
  const splitTokens = (classNameText: string): string[] =>
    classNameText.split(/\s+/).filter(Boolean);
  const literalValue = literalStringFromJsxAttributeValue(value);
  if (literalValue !== null) return { tokens: splitTokens(literalValue), isDynamic: false };
  if (!value || !isNodeOfType(value, "JSXExpressionContainer")) {
    return { tokens: [], isDynamic: false };
  }
  const expression = stripParenExpression(value.expression);
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const tokens = expression.quasis.flatMap((quasi) =>
      splitTokens(quasi.value.cooked ?? quasi.value.raw ?? ""),
    );
    return { tokens, isDynamic: expression.expressions.length > 0 };
  }
  return { tokens: [], isDynamic: true };
};

const appendOwnedElementInfo = (
  bucket: Map<string, OwnedElementInfo[]>,
  token: string,
  info: OwnedElementInfo,
): void => {
  const existing = bucket.get(token);
  if (existing) {
    existing.push(info);
  } else {
    bucket.set(token, [info]);
  }
};

// Collects the literal id / className / data-testid tokens the file's JSX
// renders, plus the per-element clobber facts (`style` prop shape, dynamic
// className, ref). The ownership link — a queried selector must match one
// of these — proves a mutated node is React-owned by this file; the facts
// prove React can actually revert the mutation.
const collectOwnedTokens = (programRoot: EsTreeNode, context: RuleContext): OwnedTokens => {
  const owned: OwnedTokens = {
    ids: new Map(),
    classNames: new Map(),
    testIds: new Map(),
  };
  walkAst(programRoot, (node: EsTreeNode) => {
    if (
      node !== programRoot &&
      isFunctionLike(node) &&
      !executesDuringRender(node, context.scopes)
    ) {
      return false;
    }
    if (!isNodeOfType(node, "JSXOpeningElement")) return;
    const idTokens: string[] = [];
    const classTokens: string[] = [];
    const testIdTokens: string[] = [];
    const info: OwnedElementInfo = {
      hasRefAttribute: false,
      styleAttribute: null,
      hasDynamicClassName: false,
    };
    for (const attribute of node.attributes) {
      if (!isNodeOfType(attribute, "JSXAttribute")) continue;
      const attributeName = getJsxAttributeName(attribute.name);
      if (!attributeName) continue;
      if (attributeName === "ref") {
        info.hasRefAttribute = true;
      } else if (attributeName === "style") {
        info.styleAttribute = styleAttributeInfoFromValue(attribute.value);
      } else if (attributeName === "className" || attributeName === "class") {
        const classNameInfo = classNameAttributeInfoFromValue(attribute.value);
        info.hasDynamicClassName = classNameInfo.isDynamic;
        classTokens.push(...classNameInfo.tokens);
      } else if (attributeName === "id") {
        const idValue = literalStringFromJsxAttributeValue(attribute.value);
        if (idValue !== null) idTokens.push(idValue);
      } else if (attributeName === "data-testid") {
        const testIdValue = literalStringFromJsxAttributeValue(attribute.value);
        if (testIdValue !== null) testIdTokens.push(testIdValue);
      }
    }
    for (const token of idTokens) appendOwnedElementInfo(owned.ids, token, info);
    for (const token of classTokens) appendOwnedElementInfo(owned.classNames, token, info);
    for (const token of testIdTokens) appendOwnedElementInfo(owned.testIds, token, info);
  });
  return owned;
};

const parseSelectorTarget = (selector: string): QueryTarget | null => {
  const idMatch = /^#([\w-]+)$/.exec(selector);
  if (idMatch) return { kind: "id", value: idMatch[1] };
  const classMatch = /^\.([\w-]+)$/.exec(selector);
  if (classMatch) return { kind: "class", value: classMatch[1] };
  const testIdMatch = /^\[data-testid=["']([^"']+)["']\]$/.exec(selector);
  if (testIdMatch) return { kind: "testid", value: testIdMatch[1] };
  return null;
};

// The static id / selector a `document.getElementById/querySelector(All)(...)`
// call targets, or null when the argument isn't a static string or the callee
// isn't a literal `document` query.
const queryCallTarget = (node: EsTreeNode, context: RuleContext): QueryTarget | null => {
  const stripped = stripParenExpression(node);
  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripParenExpression(stripped.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || receiver.name !== "document") return null;
  if (!context.scopes.isGlobalReference(receiver)) return null;
  if (
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_QUERY_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  const argument = stripped.arguments?.[0];
  if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "string") return null;
  if (callee.property.name === "getElementById") return { kind: "id", value: argument.value };
  return parseSelectorTarget(argument.value);
};

const NO_OWNED_ELEMENTS: OwnedElementInfo[] = [];

const elementInfosForQueryTarget = (
  target: QueryTarget | null,
  owned: OwnedTokens,
): OwnedElementInfo[] => {
  if (!target || EXCLUDED_QUERY_TOKENS.has(target.value)) return NO_OWNED_ELEMENTS;
  const bucket =
    target.kind === "id" ? owned.ids : target.kind === "class" ? owned.classNames : owned.testIds;
  return bucket.get(target.value) ?? NO_OWNED_ELEMENTS;
};

const camelizeCssPropertyName = (propertyName: string): string =>
  propertyName.startsWith("--")
    ? propertyName
    : propertyName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

// React re-applies inline style only when the element's `style` prop diffs
// to new per-key values, so a clobber is only provable when the matched
// element has a style prop with at least one non-literal value AND the
// mutated property is (or could be) among its keys. An element that also
// carries a `ref` is deliberately hybrid-managed — stay quiet.
const canReactClobberStyleMutation = (
  elementInfos: OwnedElementInfo[],
  mutatedPropertyName: string | null,
): boolean =>
  elementInfos.some((info) => {
    if (info.hasRefAttribute) return false;
    if (!info.styleAttribute || !info.styleAttribute.hasDynamicValue) return false;
    const knownPropertyNames = info.styleAttribute.knownPropertyNames;
    if (mutatedPropertyName === null || knownPropertyNames === null) return true;
    return (
      knownPropertyNames.has(mutatedPropertyName) ||
      knownPropertyNames.has(camelizeCssPropertyName(mutatedPropertyName))
    );
  });

// React rewrites the class attribute only when the element's `className`
// expression produces a new string, which requires a dynamic className.
const canReactClobberClassMutation = (elementInfos: OwnedElementInfo[]): boolean =>
  elementInfos.some((info) => !info.hasRefAttribute && info.hasDynamicClassName);

// `X.style.<prop>` / `X.style.cssText` → the mutated node `X`, else null.
const styleAssignmentReceiver = (assignmentTarget: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(assignmentTarget, "MemberExpression")) return null;
  const object = assignmentTarget.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "style"
  ) {
    return object.object;
  }
  return null;
};

// `X.classList.add|remove|toggle|replace(...)` → the mutated node `X`, else null.
const classListMutationReceiver = (callee: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!CLASS_LIST_MUTATION_METHODS.has(callee.property.name)) return null;
  const object = callee.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "classList"
  ) {
    return object.object;
  }
  return null;
};

// `X.style.setProperty(...)` → the mutated node `X`, else null.
const stylePropertyCallReceiver = (callee: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "setProperty") {
    return null;
  }
  const object = callee.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "style"
  ) {
    return object.object;
  }
  return null;
};

interface OwnedNodeBinding {
  identifier: EsTreeNodeOfType<"Identifier">;
  elementInfos: OwnedElementInfo[];
}

// `document.querySelectorAll('.owned').forEach((row) => ...)` → the callback
// parameter that binds each owned node, else null.
const ownedNodeListCallbackParam = (
  node: EsTreeNode,
  owned: OwnedTokens,
  context: RuleContext,
): OwnedNodeBinding | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "forEach") {
    return null;
  }
  const elementInfos = elementInfosForQueryTarget(queryCallTarget(callee.object, context), owned);
  if (elementInfos.length === 0) return null;
  const callbackArgument = node.arguments[0];
  if (!callbackArgument) return null;
  const callback = stripParenExpression(callbackArgument);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return null;
  }
  const firstParam = callback.params[0];
  return isNodeOfType(firstParam, "Identifier") ? { identifier: firstParam, elementInfos } : null;
};

// `for (const row of document.querySelectorAll('.owned'))` → the loop
// binding that holds each owned node, else null.
const ownedNodeListLoopBinding = (
  node: EsTreeNode,
  owned: OwnedTokens,
  context: RuleContext,
): OwnedNodeBinding | null => {
  if (!isNodeOfType(node, "ForOfStatement")) return null;
  const elementInfos = elementInfosForQueryTarget(queryCallTarget(node.right, context), owned);
  if (elementInfos.length === 0) return null;
  const left = node.left;
  if (!isNodeOfType(left, "VariableDeclaration")) return null;
  const declarator = left.declarations[0];
  if (!declarator || !isNodeOfType(declarator.id, "Identifier")) return null;
  return { identifier: declarator.id, elementInfos };
};

const CLEANUP_EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

const enclosingFunctionOf = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A mutation inside an effect CLEANUP restores/clears state on teardown —
// that is the rule's remediation, not the hazard.
const isReactEffectHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = context.scopes.symbolFor(callee);
    const importedName = getImportedNameFromModule(callee, callee.name, "react");
    if (importedName && symbol && isNodeOfType(symbol.declarationNode, "ImportSpecifier")) {
      return CLEANUP_EFFECT_HOOKS.has(importedName);
    }
    return CLEANUP_EFFECT_HOOKS.has(callee.name) && context.scopes.isGlobalReference(callee);
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.object, "Identifier") ||
    !isNodeOfType(callee.property, "Identifier") ||
    !CLEANUP_EFFECT_HOOKS.has(callee.property.name)
  ) {
    return false;
  }
  const objectSymbol = context.scopes.symbolFor(callee.object);
  if (
    !objectSymbol ||
    (!isNodeOfType(objectSymbol.declarationNode, "ImportNamespaceSpecifier") &&
      !isNodeOfType(objectSymbol.declarationNode, "ImportDefaultSpecifier"))
  ) {
    return false;
  }
  return (
    isNamespaceImportFromModule(callee.object, callee.object.name, "react") ||
    isDefaultImportFromModule(callee.object, callee.object.name, "react")
  );
};

const isInsideEffectCleanup = (node: EsTreeNode, context: RuleContext): boolean => {
  let cursor: EsTreeNode | null = enclosingFunctionOf(node);
  while (cursor) {
    const maybeReturn = cursor.parent;
    if (maybeReturn && isNodeOfType(maybeReturn, "ReturnStatement")) {
      const effectCallback = enclosingFunctionOf(maybeReturn);
      const effectCall = effectCallback?.parent;
      if (
        effectCallback &&
        effectCall &&
        isNodeOfType(effectCall, "CallExpression") &&
        isReactEffectHookCall(effectCall, context) &&
        effectCall.arguments?.[0] === effectCallback
      ) {
        return true;
      }
    }
    cursor = enclosingFunctionOf(cursor);
  }
  return false;
};

const nodePostDominates = (
  candidate: EsTreeNode,
  target: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(candidate);
  if (!owner || context.cfg.enclosingFunction(target) !== owner) return false;
  const functionControlFlow = context.cfg.cfgFor(owner);
  const candidateBlock = functionControlFlow?.blockOf(candidate) ?? null;
  const targetBlock = functionControlFlow?.blockOf(target) ?? null;
  if (!functionControlFlow || !candidateBlock || !targetBlock) return false;
  if (candidateBlock === targetBlock) return candidate.range[0] < target.range[0];
  const resultByBlockId = new Map<number, boolean>();
  const visitingBlockIds = new Set<number>();
  const blockById = new Map(functionControlFlow.blocks.map((block) => [block.id, block]));
  const everyPathReachesTarget = (blockId: number): boolean => {
    if (blockId === targetBlock.id) return true;
    if (blockId === functionControlFlow.exit.id || visitingBlockIds.has(blockId)) return false;
    const cachedResult = resultByBlockId.get(blockId);
    if (cachedResult !== undefined) return cachedResult;
    const block = blockById.get(blockId);
    if (!block || block.successors.length === 0) return false;
    visitingBlockIds.add(blockId);
    const result = block.successors.every((edge) => everyPathReachesTarget(edge.to.id));
    visitingBlockIds.delete(blockId);
    resultByBlockId.set(blockId, result);
    return result;
  };
  return everyPathReachesTarget(candidateBlock.id);
};

// `const prev = node.style.boxShadow; node.style.boxShadow = 'none';
// ... node.style.boxShadow = prev` — the property is saved before and
// restored after (try/finally export snapshots, auto-fit measurement).
const hasStyleSaveRestore = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): boolean => {
  const target = assignment.left;
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    !isNodeOfType(target.property, "Identifier")
  ) {
    return false;
  }
  const propertyName = target.property.name;
  const receiver = styleAssignmentReceiver(target);
  const receiverIdentifier = receiver ? stripParenExpression(receiver) : null;
  const receiverSymbol =
    receiverIdentifier && isNodeOfType(receiverIdentifier, "Identifier")
      ? context.scopes.symbolFor(receiverIdentifier)
      : null;
  if (!receiverSymbol) return false;
  const scope = enclosingFunctionOf(assignment);
  if (!scope) return false;
  const matchesStyleRead = (candidate: EsTreeNode): boolean => {
    if (!isNodeOfType(candidate, "MemberExpression") || candidate.computed) return false;
    if (!isNodeOfType(candidate.property, "Identifier")) return false;
    if (candidate.property.name !== propertyName) return false;
    const readReceiver = styleAssignmentReceiver(candidate);
    const readReceiverIdentifier = readReceiver ? stripParenExpression(readReceiver) : null;
    return Boolean(
      readReceiverIdentifier &&
      isNodeOfType(readReceiverIdentifier, "Identifier") &&
      context.scopes.symbolFor(readReceiverIdentifier)?.id === receiverSymbol.id,
    );
  };
  const savedDeclarationsBySymbolId = new Map<number, EsTreeNode>();
  walkAst(scope, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init &&
      matchesStyleRead(stripParenExpression(child.init as EsTreeNode)) &&
      nodeDominatesNode(child, assignment, context)
    ) {
      const savedSymbol = context.scopes.symbolFor(child.id);
      if (savedSymbol) savedDeclarationsBySymbolId.set(savedSymbol.id, child);
    }
  });
  if (savedDeclarationsBySymbolId.size === 0) return false;
  const ownValue = stripParenExpression(assignment.right as EsTreeNode);
  if (
    isNodeOfType(ownValue, "Identifier") &&
    savedDeclarationsBySymbolId.has(context.scopes.symbolFor(ownValue)?.id ?? -1)
  ) {
    return true;
  }
  let restored = false;
  walkAst(scope, (child: EsTreeNode) => {
    if (restored) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child !== assignment &&
      matchesStyleRead(child.left as EsTreeNode)
    ) {
      const value = stripParenExpression(child.right as EsTreeNode);
      if (
        isNodeOfType(value, "Identifier") &&
        savedDeclarationsBySymbolId.has(context.scopes.symbolFor(value)?.id ?? -1) &&
        nodePostDominates(assignment, child, context)
      ) {
        restored = true;
        return false;
      }
    }
  });
  return restored;
};

export const noMutateQueriedDomNodeInComponent = defineRule({
  id: "no-mutate-queried-dom-node-in-component",
  title: "Mutating a queried DOM node this component renders",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Drive the node with state/props (or a ref for genuinely uncontrolled nodes) instead of querying it and mutating its style/class. Imperative edits to a node React renders are invisible to the virtual DOM and get reverted or clobbered on the next render.",
  create: (context: RuleContext) => {
    const reported = new WeakSet<EsTreeNode>();

    const elementInfosForReceiver = (
      receiver: EsTreeNode,
      ownedQueryVariables: Map<number, OwnedElementInfo[]>,
      owned: OwnedTokens,
    ): OwnedElementInfo[] => {
      const stripped = stripParenExpression(receiver);
      if (isNodeOfType(stripped, "Identifier")) {
        const receiverSymbol = context.scopes.symbolFor(stripped);
        return receiverSymbol
          ? (ownedQueryVariables.get(receiverSymbol.id) ?? NO_OWNED_ELEMENTS)
          : NO_OWNED_ELEMENTS;
      }
      if (isNodeOfType(stripped, "CallExpression")) {
        return elementInfosForQueryTarget(queryCallTarget(stripped, context), owned);
      }
      return NO_OWNED_ELEMENTS;
    };

    // `X.style.<prop> = ...` → the CSS property React would diff against,
    // or null when it is unknowable (computed key, `cssText`), in which
    // case any dynamic style prop on the element counts as a clobber risk.
    const mutatedStylePropertyName = (assignmentTarget: EsTreeNode): string | null => {
      if (!isNodeOfType(assignmentTarget, "MemberExpression")) return null;
      if (assignmentTarget.computed) return null;
      if (!isNodeOfType(assignmentTarget.property, "Identifier")) return null;
      return assignmentTarget.property.name === "cssText" ? null : assignmentTarget.property.name;
    };

    const setPropertyArgumentName = (node: EsTreeNodeOfType<"CallExpression">): string | null => {
      const firstArgument = node.arguments?.[0];
      if (
        firstArgument &&
        isNodeOfType(firstArgument, "Literal") &&
        typeof firstArgument.value === "string"
      ) {
        return firstArgument.value;
      }
      return null;
    };

    const reportMutation = (node: EsTreeNode, mutatedSurface: "style" | "classList"): void => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({
        node,
        message: `You mutate the ${mutatedSurface} of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.`,
      });
    };

    const analyzeComponent = (functionNode: EsTreeNode, owned: OwnedTokens): void => {
      const ownedQueryVariables = new Map<number, OwnedElementInfo[]>();
      const ownedStyleVariables = new Map<number, OwnedElementInfo[]>();
      walkAst(functionNode, (node: EsTreeNode) => {
        if (isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "Identifier")) {
          const queryInfos = node.init
            ? elementInfosForQueryTarget(queryCallTarget(node.init, context), owned)
            : NO_OWNED_ELEMENTS;
          if (queryInfos.length > 0) {
            const bindingSymbol = context.scopes.symbolFor(node.id);
            if (bindingSymbol) ownedQueryVariables.set(bindingSymbol.id, queryInfos);
            return;
          }
          if (
            node.init &&
            isNodeOfType(node.init, "MemberExpression") &&
            !node.init.computed &&
            isNodeOfType(node.init.property, "Identifier") &&
            node.init.property.name === "style"
          ) {
            const styleElementInfos = elementInfosForReceiver(
              node.init.object,
              ownedQueryVariables,
              owned,
            );
            const bindingSymbol = context.scopes.symbolFor(node.id);
            if (bindingSymbol && styleElementInfos.length > 0) {
              ownedStyleVariables.set(bindingSymbol.id, styleElementInfos);
            }
          }
        }
        const iterationBinding =
          ownedNodeListCallbackParam(node, owned, context) ??
          ownedNodeListLoopBinding(node, owned, context);
        if (iterationBinding) {
          const bindingSymbol = context.scopes.symbolFor(iterationBinding.identifier);
          if (bindingSymbol) {
            ownedQueryVariables.set(bindingSymbol.id, iterationBinding.elementInfos);
          }
        }
      });

      walkAst(functionNode, (node: EsTreeNode) => {
        if (isNodeOfType(node, "AssignmentExpression")) {
          const receiver = styleAssignmentReceiver(node.left);
          let elementInfos = receiver
            ? elementInfosForReceiver(receiver, ownedQueryVariables, owned)
            : NO_OWNED_ELEMENTS;
          if (
            elementInfos.length === 0 &&
            isNodeOfType(node.left, "MemberExpression") &&
            isNodeOfType(node.left.object, "Identifier")
          ) {
            const styleSymbol = context.scopes.symbolFor(node.left.object);
            elementInfos = styleSymbol
              ? (ownedStyleVariables.get(styleSymbol.id) ?? NO_OWNED_ELEMENTS)
              : NO_OWNED_ELEMENTS;
          }
          if (elementInfos.length === 0) return;
          if (canReactClobberStyleMutation(elementInfos, mutatedStylePropertyName(node.left))) {
            if (isInsideEffectCleanup(node, context) || hasStyleSaveRestore(node, context)) return;
            reportMutation(node, "style");
          }
          return;
        }
        if (isNodeOfType(node, "CallExpression")) {
          const classListReceiver = classListMutationReceiver(node.callee);
          if (classListReceiver) {
            const elementInfos = elementInfosForReceiver(
              classListReceiver,
              ownedQueryVariables,
              owned,
            );
            if (canReactClobberClassMutation(elementInfos)) {
              if (isInsideEffectCleanup(node, context)) return;
              reportMutation(node, "classList");
            }
            return;
          }
          const styleReceiver = stylePropertyCallReceiver(node.callee);
          let styleElementInfos = styleReceiver
            ? elementInfosForReceiver(styleReceiver, ownedQueryVariables, owned)
            : NO_OWNED_ELEMENTS;
          const callee = stripParenExpression(node.callee);
          if (
            styleElementInfos.length === 0 &&
            isNodeOfType(callee, "MemberExpression") &&
            !callee.computed &&
            isNodeOfType(callee.property, "Identifier") &&
            callee.property.name === "setProperty" &&
            isNodeOfType(callee.object, "Identifier")
          ) {
            const styleSymbol = context.scopes.symbolFor(callee.object);
            styleElementInfos = styleSymbol
              ? (ownedStyleVariables.get(styleSymbol.id) ?? NO_OWNED_ELEMENTS)
              : NO_OWNED_ELEMENTS;
          }
          if (styleElementInfos.length > 0) {
            if (canReactClobberStyleMutation(styleElementInfos, setPropertyArgumentName(node))) {
              if (isInsideEffectCleanup(node, context)) return;
              reportMutation(node, "style");
            }
          }
        }
      });
    };

    const visitFunction = (functionNode: EsTreeNode): void => {
      if (!componentOrHookDisplayNameForFunction(functionNode)) return;
      analyzeComponent(functionNode, collectOwnedTokens(functionNode, context));
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        visitFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        visitFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        visitFunction(node);
      },
    };
  },
});
