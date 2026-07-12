import { BOOLEAN_PROP_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isBooleanPrefixedPropName } from "../../utils/is-boolean-prefixed-prop-name.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { resolveFirstArgumentBinding } from "../../utils/resolve-first-argument-binding.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { unwrapReactHocFunction } from "../../utils/unwrap-react-hoc-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// `show`/`hide`/`enable`/`disable` names read as commands, so passing one
// as a call argument (`setTimeout(props.showMenu, 100)`) marks it as a
// callback. `is`/`has`/`can`/… names passed as arguments stay boolean data
// (`classNames(props.isActive)`).
const IMPERATIVE_CALLBACK_PREFIX_PATTERN = /^(?:show|hide|enable|disable)[A-Z]/;

// Prop names whose value is invoked (`showMenu()`), wired up as an event
// handler (`onClick={showMenu}`), or handed to another call as an
// imperative-prefixed argument (`register(enableSave)`) are callbacks, not
// on/off flags — the boolean-prefix heuristic misreads `show`/`hide`/
// `enable`/`disable` callbacks as booleans, so drop them from the count.
// Only identifiers that resolve to the component's own props parameter
// count; a shadowed inner binding sharing a prop's name must not exclude it.
const collectCallbackUsedNames = (
  componentBody: EsTreeNode | undefined,
  propsParam: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> => {
  const callbackNames = new Set<string>();
  if (!componentBody) return callbackNames;
  const addWhenPropsBinding = (identifier: EsTreeNodeOfType<"Identifier">): void => {
    const symbol = scopes.symbolFor(identifier);
    if (!symbol || symbol.declarationNode !== propsParam) return;
    callbackNames.add(symbol.name);
  };
  walkAst(componentBody, (child: EsTreeNode) => {
    if (isNodeOfType(child, "CallExpression")) {
      if (isNodeOfType(child.callee, "Identifier")) {
        addWhenPropsBinding(child.callee);
      }
      for (const argumentNode of child.arguments) {
        if (
          isNodeOfType(argumentNode, "Identifier") &&
          IMPERATIVE_CALLBACK_PREFIX_PATTERN.test(argumentNode.name)
        ) {
          addWhenPropsBinding(argumentNode);
        }
      }
      return;
    }
    if (
      isEventHandlerAttribute(child) &&
      isNodeOfType(child.value, "JSXExpressionContainer") &&
      isNodeOfType(child.value.expression, "Identifier")
    ) {
      addWhenPropsBinding(child.value.expression);
    }
  });
  return callbackNames;
};

const getDestructuredBindingName = (propertyValue: EsTreeNode | undefined): string | null => {
  if (isNodeOfType(propertyValue, "Identifier")) return propertyValue.name;
  if (
    isNodeOfType(propertyValue, "AssignmentPattern") &&
    isNodeOfType(propertyValue.left, "Identifier")
  ) {
    return propertyValue.left.name;
  }
  return null;
};

const collectBooleanLikePropsFromBody = (
  componentBody: EsTreeNode | undefined,
  propsParamName: string,
): Set<string> => {
  const found = new Set<string>();
  if (!componentBody) return found;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "MemberExpression")) return;
    if (child.computed) return;
    if (!isNodeOfType(child.object, "Identifier")) return;
    if (child.object.name !== propsParamName) return;
    if (!isNodeOfType(child.property, "Identifier")) return;
    if (!isBooleanPrefixedPropName(child.property.name)) return;
    // `props.showMenu()` (invoked), `onClick={props.showMenu}` (wired as an
    // event handler), and `setTimeout(props.showMenu, 100)` (imperative name
    // passed as a call argument) are callbacks, not boolean props — mirror
    // the destructured-param callback exclusion for the `props` object shape.
    const parent = child.parent;
    if (isNodeOfType(parent, "CallExpression")) {
      if (parent.callee === child) return;
      if (
        IMPERATIVE_CALLBACK_PREFIX_PATTERN.test(child.property.name) &&
        parent.arguments.some((argumentNode) => argumentNode === child)
      ) {
        return;
      }
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && isEventHandlerAttribute(parent.parent)) {
      return;
    }
    found.add(child.property.name);
  });
  return found;
};

// HACK: components with many boolean props (isLoading, hasIcon, showHeader,
// canEdit...) typically signal "many UI variants jammed into one component"
// — a sign that the component should be split via composition (compound
// components, explicit variant components). We use a name-based heuristic
// because TypeScript types aren't visible at this AST layer. Detects
// both destructured form (`{ isPrimary, hasIcon }`) and non-destructured
// (`function Foo(props) { props.isPrimary }`) by walking member-access
// patterns on the parameter binding.
export const noManyBooleanProps = defineRule({
  id: "no-many-boolean-props",
  title: "Boolean prop combinations are hard to test",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Split boolean-heavy APIs into smaller components or named variants so combinations stay testable.",
  create: (context: RuleContext) => {
    const reportIfMany = (
      booleanLikePropNames: string[],
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (booleanLikePropNames.length >= BOOLEAN_PROP_THRESHOLD) {
        context.report({
          node: reportNode,
          message: `Component "${componentName}" takes ${booleanLikePropNames.length} on/off props (${booleanLikePropNames.slice(0, 3).join(", ")}…), which is hard to combine & test. Split it into smaller components or named variants.`,
        });
      }
    };

    const checkComponent = (
      functionNode: EsTreeNode,
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (!param) return;
      const propsBinding = resolveFirstArgumentBinding(param);
      if (!propsBinding) return;
      // The component gates (uppercase name) also match non-component
      // factories like `function CreateValidator(options) { … }`, whose
      // `options.isStrict` accesses look like boolean props. Require
      // actual render output before treating the param as component props.
      if (!functionContainsReactRenderOutput(functionNode, context.scopes)) return;
      if (isNodeOfType(propsBinding, "ObjectPattern")) {
        const callbackUsedNames = collectCallbackUsedNames(body, param, context.scopes);
        const booleanLikePropNames: string[] = [];
        for (const property of propsBinding.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
          if (!keyName) continue;
          // `{ showMenu: openMenu }` binds `openMenu`, so the callback
          // exclusion matches the VALUE binding name; reported prop names
          // stay the KEY names.
          const bindingName = getDestructuredBindingName(property.value);
          if (bindingName && callbackUsedNames.has(bindingName)) continue;
          if (isBooleanPrefixedPropName(keyName)) {
            booleanLikePropNames.push(keyName);
          }
        }
        reportIfMany(booleanLikePropNames, componentName, reportNode);
        return;
      }
      if (isNodeOfType(propsBinding, "Identifier")) {
        const accessed = collectBooleanLikePropsFromBody(body, propsBinding.name);
        reportIfMany([...accessed], componentName, reportNode);
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        checkComponent(node, node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !isUppercaseName(node.id.name)) return;
        const functionNode = unwrapReactHocFunction(node.init);
        if (!functionNode) return;
        checkComponent(
          functionNode,
          functionNode.params?.[0],
          functionNode.body,
          node.id.name,
          node.id,
        );
      },
    };
  },
});
