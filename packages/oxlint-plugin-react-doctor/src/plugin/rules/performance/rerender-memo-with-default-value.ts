import { COMPONENT_HOC_WRAPPER_NAMES, HOOKS_WITH_DEPS } from "../../constants/react.js";
import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DEP_TAKING_HOOK_NAMES = new Set<string>([
  ...HOOKS_WITH_DEPS,
  "useInsertionEffect",
  "useImperativeHandle",
]);

type EmptyLiteralKind = "object" | "array";
type IdentitySensitiveUse = "memoized-prop" | "dependency-array";

interface DefaultedEmptyBinding {
  readonly defaultValueNode: EsTreeNode;
  readonly literalKind: EmptyLiteralKind;
}

const emptyLiteralKindOf = (expression: EsTreeNode): EmptyLiteralKind | null => {
  if (isNodeOfType(expression, "ObjectExpression") && (expression.properties ?? []).length === 0) {
    return "object";
  }
  if (isNodeOfType(expression, "ArrayExpression") && (expression.elements ?? []).length === 0) {
    return "array";
  }
  return null;
};

const collectFromObjectPattern = (
  pattern: EsTreeNode,
  bindings: Map<string, DefaultedEmptyBinding>,
): void => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return;
  for (const property of pattern.properties ?? []) {
    if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "AssignmentPattern"))
      continue;
    const boundName = property.value.left;
    if (!isNodeOfType(boundName, "Identifier")) continue;
    const literalKind = emptyLiteralKindOf(property.value.right);
    if (!literalKind) continue;
    bindings.set(boundName.name, {
      defaultValueNode: property.value.right,
      literalKind,
    });
  }
};

// Defaulted empty literals live either in the parameter pattern
// (`({ items = [] }) => …`) or in a body destructure of the props param
// (`const { items = [] } = props`) — both allocate a fresh reference per
// render.
const collectDefaultedEmptyBindings = (
  functionNode: EsTreeNode,
): Map<string, DefaultedEmptyBinding> => {
  const bindings = new Map<string, DefaultedEmptyBinding>();
  const params = (functionNode as { params?: EsTreeNode[] }).params ?? [];
  for (const param of params) {
    collectFromObjectPattern(param, bindings);
  }
  const propsParam = params[0];
  const body = (functionNode as { body?: EsTreeNode }).body;
  if (!propsParam || !isNodeOfType(propsParam, "Identifier") || !body) return bindings;
  if (!isNodeOfType(body, "BlockStatement")) return bindings;
  for (const statement of body.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) continue;
      const initializer = stripParenExpression(declarator.init as EsTreeNode);
      if (!isNodeOfType(initializer, "Identifier") || initializer.name !== propsParam.name)
        continue;
      collectFromObjectPattern(declarator.id as EsTreeNode, bindings);
    }
  }
  return bindings;
};

const isFunctionExpressionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const hocCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// `const Chart = forwardRef(function Chart(props, ref) {…})` (and
// memo/observer chains) still render through the inner function — unwrap
// wrapper calls down to it so its props defaults get checked.
const unwrapHocWrappedFunction = (expression: EsTreeNode): EsTreeNode | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "CallExpression")) {
    const calleeName = hocCalleeName(current.callee as EsTreeNode);
    if (!calleeName || !COMPONENT_HOC_WRAPPER_NAMES.has(calleeName)) return null;
    const firstArgument = current.arguments?.[0];
    if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return null;
    current = stripParenExpression(firstArgument as EsTreeNode);
  }
  return isFunctionExpressionLike(current) ? current : null;
};

const isIntrinsicJsxElementName = (openingName: EsTreeNode | null | undefined): boolean => {
  if (!openingName || !isNodeOfType(openingName, "JSXIdentifier")) return false;
  const firstCharacterCode = openingName.name.charCodeAt(0);
  return firstCharacterCode >= 97 && firstCharacterCode <= 122;
};

const markCandidateIdentifier = (
  expression: EsTreeNode | null | undefined,
  candidateNames: ReadonlySet<string>,
  shadowedNames: ReadonlySet<string>,
  use: IdentitySensitiveUse,
  into: Map<string, IdentitySensitiveUse>,
): void => {
  if (!expression) return;
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return;
  if (shadowedNames.has(stripped.name)) return;
  if (!candidateNames.has(stripped.name)) return;
  if (!into.has(stripped.name)) into.set(stripped.name, use);
};

const collectIdentitySensitiveUses = (
  node: EsTreeNode,
  candidateNames: ReadonlySet<string>,
  shadowedNames: ReadonlySet<string>,
  memoRegistry: Map<string, MemoStatus>,
  into: Map<string, IdentitySensitiveUse>,
): void => {
  let innerShadowedNames = shadowedNames;
  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    const parameterNames = new Set<string>();
    for (const param of node.params ?? []) {
      collectPatternNames(param, parameterNames);
    }
    const shadowedCandidates = [...candidateNames].filter((name) => parameterNames.has(name));
    if (shadowedCandidates.length > 0) {
      innerShadowedNames = new Set([...shadowedNames, ...shadowedCandidates]);
    }
  }

  if (isNodeOfType(node, "CallExpression") && isHookCall(node, DEP_TAKING_HOOK_NAMES)) {
    for (const argument of node.arguments ?? []) {
      if (!isNodeOfType(argument, "ArrayExpression")) continue;
      for (const element of argument.elements ?? []) {
        markCandidateIdentifier(
          element,
          candidateNames,
          innerShadowedNames,
          "dependency-array",
          into,
        );
      }
    }
  }

  if (isNodeOfType(node, "JSXOpeningElement")) {
    const openingName = node.name as EsTreeNode;
    const memoStatus = memoStatusForJsxOpeningName(memoRegistry, openingName);
    if (!isIntrinsicJsxElementName(openingName) && memoStatus !== "not-memoised") {
      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) continue;
        const attributeExpression = attribute.value.expression;
        if (!attributeExpression || attributeExpression.type === "JSXEmptyExpression") continue;
        markCandidateIdentifier(
          attributeExpression,
          candidateNames,
          innerShadowedNames,
          "memoized-prop",
          into,
        );
      }
    }
  }

  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) {
          collectIdentitySensitiveUses(
            item,
            candidateNames,
            innerShadowedNames,
            memoRegistry,
            into,
          );
        }
      }
    } else if (isAstNode(child)) {
      collectIdentitySensitiveUses(child, candidateNames, innerShadowedNames, memoRegistry, into);
    }
  }
};

const buildMessage = (literalKind: EmptyLiteralKind, use: IdentitySensitiveUse): string => {
  const literal = literalKind === "object" ? "{}" : "[]";
  const allocation = literalKind === "object" ? "object" : "array";
  if (use === "dependency-array") {
    return `This reruns hooks that list it in their dependency array because default prop value ${literal} makes a brand new ${allocation} every render, so move it to a constant at the top of the file`;
  }
  return `This keeps redrawing children that compare props because default prop value ${literal} makes a brand new ${allocation} every render, so move it to a constant at the top of the file`;
};

// Only fires when the defaulted binding is consumed in an
// identity-sensitive position: listed in a hook dependency array, or
// passed whole as a JSX prop to a component that isn't provably
// un-memoized in the same file. Local consumption — destructuring,
// member reads, spreading into fresh objects, function arguments,
// `.map` in render — never compares the object's identity, so the
// fresh `{}` / `[]` per render breaks nothing there.
export const rerenderMemoWithDefaultValue = defineRule({
  id: "rerender-memo-with-default-value",
  title: "Empty default prop breaks memo",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move it to the top of the file: `const EMPTY_ITEMS: Item[] = []`, then use that as the default value",
  create: (context: RuleContext) => {
    let memoRegistry: Map<string, MemoStatus> = new Map();

    const checkComponentFunction = (functionNode: EsTreeNode): void => {
      if (
        !isNodeOfType(functionNode, "FunctionDeclaration") &&
        !isNodeOfType(functionNode, "FunctionExpression") &&
        !isNodeOfType(functionNode, "ArrowFunctionExpression")
      )
        return;
      const defaultedBindings = collectDefaultedEmptyBindings(functionNode);
      if (defaultedBindings.size === 0) return;
      if (!functionNode.body) return;

      const identitySensitiveUses = new Map<string, IdentitySensitiveUse>();
      collectIdentitySensitiveUses(
        functionNode.body,
        new Set(defaultedBindings.keys()),
        new Set(),
        memoRegistry,
        identitySensitiveUses,
      );

      for (const [bindingName, binding] of defaultedBindings) {
        const use = identitySensitiveUses.get(bindingName);
        if (!use) continue;
        context.report({
          node: binding.defaultValueNode,
          message: buildMessage(binding.literalKind, use),
        });
      }
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        memoRegistry = buildSameFileMemoRegistry(node as EsTreeNode);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponentFunction(node as EsTreeNode);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (isComponentAssignment(node)) {
          checkComponentFunction(node.init as EsTreeNode);
          return;
        }
        if (!isNodeOfType(node.id, "Identifier") || !isUppercaseName(node.id.name) || !node.init)
          return;
        const wrappedFunction = unwrapHocWrappedFunction(node.init as EsTreeNode);
        if (wrappedFunction) checkComponentFunction(wrappedFunction);
      },
    };
  },
});
