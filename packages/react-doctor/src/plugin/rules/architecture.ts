import {
  BOOLEAN_PROP_THRESHOLD,
  GENERIC_EVENT_SUFFIXES,
  GIANT_COMPONENT_LINE_THRESHOLD,
  RENDER_FUNCTION_PATTERN,
  RENDER_PROP_PROLIFERATION_THRESHOLD,
} from "../constants.js";
import {
  isComponentAssignment,
  isComponentDeclaration,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const noGenericHandlerNames: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || !node.name.name.startsWith("on")) return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const eventSuffix = node.name.name.slice(2);
      if (!GENERIC_EVENT_SUFFIXES.has(eventSuffix)) return;

      const mirroredHandlerName = `handle${eventSuffix}`;
      const expression = node.value.expression;
      if (expression?.type === "Identifier" && expression.name === mirroredHandlerName) {
        context.report({
          node,
          message: `Non-descriptive handler name "${expression.name}" — name should describe what it does, not when it runs`,
        });
      }
    },
  }),
};

export const noGiantComponent: Rule = {
  create: (context: RuleContext) => {
    const reportOversizedComponent = (
      nameNode: EsTreeNode,
      componentName: string,
      bodyNode: EsTreeNode,
    ): void => {
      if (!bodyNode.loc) return;
      const lineCount = bodyNode.loc.end.line - bodyNode.loc.start.line + 1;
      if (lineCount > GIANT_COMPONENT_LINE_THRESHOLD) {
        context.report({
          node: nameNode,
          message: `Component "${componentName}" is ${lineCount} lines — consider breaking it into smaller focused components`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        reportOversizedComponent(node.id, node.id.name, node);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        reportOversizedComponent(node.id, node.id.name, node.init);
      },
    };
  },
};

export const noRenderInRender: Rule = {
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNode) {
      const expression = node.expression;
      if (expression?.type !== "CallExpression") return;

      let calleeName: string | null = null;
      if (expression.callee?.type === "Identifier") {
        calleeName = expression.callee.name;
      } else if (
        expression.callee?.type === "MemberExpression" &&
        expression.callee.property?.type === "Identifier"
      ) {
        calleeName = expression.callee.property.name;
      }

      if (calleeName && RENDER_FUNCTION_PATTERN.test(calleeName)) {
        context.report({
          node: expression,
          message: `Inline render function "${calleeName}()" — extract to a separate component for proper reconciliation`,
        });
      }
    },
  }),
};

export const noNestedComponentDefinition: Rule = {
  create: (context: RuleContext) => {
    const componentStack: string[] = [];

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!isComponentDeclaration(node)) return;
        if (componentStack.length > 0) {
          context.report({
            node: node.id,
            message: `Component "${node.id.name}" defined inside "${componentStack[componentStack.length - 1]}" — creates new instance every render, destroying state`,
          });
        }
        componentStack.push(node.id.name);
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (isComponentDeclaration(node)) componentStack.pop();
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        if (componentStack.length > 0) {
          context.report({
            node: node.id,
            message: `Component "${node.id.name}" defined inside "${componentStack[componentStack.length - 1]}" — creates new instance every render, destroying state`,
          });
        }
        componentStack.push(node.id.name);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) componentStack.pop();
      },
    };
  },
};

const BOOLEAN_PROP_PREFIX_PATTERN = /^(?:is|has|should|can|show|hide|enable|disable|with)[A-Z]/;

const collectBooleanLikePropsFromBody = (
  componentBody: EsTreeNode | undefined,
  propsParamName: string,
): Set<string> => {
  const found = new Set<string>();
  if (!componentBody) return found;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (child.type !== "MemberExpression") return;
    if (child.computed) return;
    if (child.object?.type !== "Identifier") return;
    if (child.object.name !== propsParamName) return;
    if (child.property?.type !== "Identifier") return;
    if (!BOOLEAN_PROP_PREFIX_PATTERN.test(child.property.name)) return;
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
export const noManyBooleanProps: Rule = {
  create: (context: RuleContext) => {
    const reportIfMany = (
      booleanLikePropNames: string[],
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (booleanLikePropNames.length >= BOOLEAN_PROP_THRESHOLD) {
        context.report({
          node: reportNode,
          message: `Component "${componentName}" takes ${booleanLikePropNames.length} boolean-like props (${booleanLikePropNames.slice(0, 3).join(", ")}…) — consider compound components or explicit variants instead of stacking flags`,
        });
      }
    };

    const checkComponent = (
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (!param) return;
      if (param.type === "ObjectPattern") {
        const booleanLikePropNames: string[] = [];
        for (const property of param.properties ?? []) {
          if (property.type !== "Property") continue;
          const keyName = property.key?.type === "Identifier" ? property.key.name : null;
          if (!keyName) continue;
          if (BOOLEAN_PROP_PREFIX_PATTERN.test(keyName)) {
            booleanLikePropNames.push(keyName);
          }
        }
        reportIfMany(booleanLikePropNames, componentName, reportNode);
        return;
      }
      if (param.type === "Identifier") {
        const accessed = collectBooleanLikePropsFromBody(body, param.name);
        reportIfMany([...accessed], componentName, reportNode);
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!isComponentDeclaration(node)) return;
        checkComponent(node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.params?.[0], node.init?.body, node.id.name, node.id);
      },
    };
  },
};

// HACK: React 19+ deprecated `forwardRef` (refs are now regular props on
// function components) and `useContext` (replaced by the more flexible
// `use()`). Catches both named imports (`import { forwardRef } from "react"`)
// AND member access on namespace/default imports (`React.forwardRef`,
// `React.useContext` after `import React from "react"` or
// `import * as React from "react"`).
const REACT_19_DEPRECATED_MESSAGES: Record<string, string> = {
  forwardRef:
    "forwardRef is no longer needed on React 19+ — refs are regular props on function components; remove forwardRef and pass ref directly",
  useContext:
    "useContext is superseded by `use()` on React 19+ — `use()` reads context conditionally inside hooks, branches, and loops; switch to `import { use } from 'react'`",
};

export const noReact19DeprecatedApis: Rule = {
  create: (context: RuleContext) => {
    const reactNamespaceBindings = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNode) {
        if (node.source?.value !== "react") return;
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === "ImportSpecifier") {
            const importedName = specifier.imported?.name;
            if (!importedName) continue;
            const message = REACT_19_DEPRECATED_MESSAGES[importedName];
            if (message) context.report({ node: specifier, message });
            continue;
          }
          if (
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            const localName = specifier.local?.name;
            if (localName) reactNamespaceBindings.add(localName);
          }
        }
      },
      MemberExpression(node: EsTreeNode) {
        if (reactNamespaceBindings.size === 0) return;
        if (node.computed) return;
        if (node.object?.type !== "Identifier") return;
        if (!reactNamespaceBindings.has(node.object.name)) return;
        if (node.property?.type !== "Identifier") return;
        const message = REACT_19_DEPRECATED_MESSAGES[node.property.name];
        if (message) context.report({ node, message });
      },
    };
  },
};

const RENDER_PROP_PATTERN = /^render[A-Z]/;

// HACK: render-prop proliferation (`<Foo renderHeader={…} renderFooter={…}
// renderActions={…} />`) is the smell — a single render-prop is often
// the legitimate library API (MUI Autocomplete's `renderInput`, FlatList's
// `renderItem`, react-hook-form's Controller `render`, etc.) and we
// shouldn't fire on those. Instead we flag the COMPOUND case: when a
// single element receives 3 or more `render*` props, that's the smell
// of "many slots cobbled together where compound components or
// `children` would be cleaner".
export const noRenderPropChildren: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const renderPropAttrs: Array<{ name: string; node: EsTreeNode }> = [];
      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier") continue;
        const name = attr.name.name;
        if (!RENDER_PROP_PATTERN.test(name)) continue;
        renderPropAttrs.push({ name, node: attr });
      }
      if (renderPropAttrs.length < RENDER_PROP_PROLIFERATION_THRESHOLD) return;

      const propList = renderPropAttrs
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(", ");
      context.report({
        node: renderPropAttrs[0].node,
        message: `${renderPropAttrs.length} render-prop slots on the same element (${propList}…) — collapse into compound subcomponents or \`children\` so consumers don't need to know about every customization point`,
      });
    },
  }),
};

const HOOK_OBJECTS_WITH_METHODS = new Map<string, Set<string>>([
  ["useRouter", new Set(["push", "replace", "back", "forward", "refresh", "prefetch"])],
  [
    "useNavigation",
    new Set(["navigate", "push", "goBack", "popToTop", "reset", "replace", "dispatch"]),
  ],
  ["useSearchParams", new Set(["get", "getAll", "has", "set"])],
]);

// HACK: O(1) lookup. Indexes top-level `const x = useFooBar(...)`
// declarations once per component on enter, so subsequent
// MemberExpression visitors don't re-walk the whole body for every
// access.
const buildHookBindingMap = (componentBody: EsTreeNode): Map<string, string> => {
  const result = new Map<string, string>();
  if (componentBody?.type !== "BlockStatement") return result;
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      if (declarator.init?.type !== "CallExpression") continue;
      const callee = declarator.init.callee;
      if (callee?.type !== "Identifier") continue;
      result.set(declarator.id.name, callee.name);
    }
  }
  return result;
};

// HACK: React Compiler memoizes inside a component based on stable
// reference equality of *destructured* values. `router.push("/x")`
// reads `push` off the hook return on every render, which the compiler
// can't memoize as cleanly as a destructured `const { push } = useRouter()`.
// The destructured form also makes the dependency graph obvious — if
// you only need `push`, the compiler doesn't need to track all of
// `router`. This is a soft signal even without React Compiler enabled
// (it makes intent clearer and reduces accidental capture).
//
// Heuristic: `router.push(...)` (or any of the canonical hook objects)
// where `router` is bound to a `useRouter()` call in the same component.
// We don't fire when the binding is destructured already.
export const reactCompilerDestructureMethod: Rule = {
  create: (context: RuleContext) => {
    const hookBindingMapStack: Array<Map<string, string>> = [];

    const isComponent = (node: EsTreeNode): boolean => {
      if (node.type === "FunctionDeclaration") {
        return Boolean(node.id?.name && isUppercaseName(node.id.name));
      }
      if (node.type === "VariableDeclarator") {
        return isComponentAssignment(node);
      }
      return false;
    };

    // HACK: push UNCONDITIONALLY for every component so push/pop stay
    // balanced. A concise-arrow component (`const Foo = () => <div />`)
    // has no BlockStatement body and therefore no hook bindings, but it
    // still triggers the matching `:exit` — without an unconditional
    // push, the exit would pop the *outer* component's frame and silently
    // drop diagnostics on every member access in the parent. The empty
    // Map returned by `buildHookBindingMap` for non-Block bodies is the
    // correct semantic for "this component declares zero hook bindings".
    const enter = (node: EsTreeNode): void => {
      if (!isComponent(node)) return;
      const body = node.type === "FunctionDeclaration" ? node.body : node.init?.body;
      hookBindingMapStack.push(buildHookBindingMap(body));
    };
    const exit = (node: EsTreeNode): void => {
      if (isComponent(node)) hookBindingMapStack.pop();
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      VariableDeclarator: enter,
      "VariableDeclarator:exit": exit,
      MemberExpression(node: EsTreeNode) {
        if (hookBindingMapStack.length === 0) return;
        if (node.computed) return;
        if (node.object?.type !== "Identifier") return;
        if (node.property?.type !== "Identifier") return;

        const bindingName = node.object.name;
        const methodName = node.property.name;
        const hookBindings = hookBindingMapStack[hookBindingMapStack.length - 1];
        const hookSource = hookBindings.get(bindingName);
        if (!hookSource) return;

        const allowedMethods = HOOK_OBJECTS_WITH_METHODS.get(hookSource);
        if (!allowedMethods || !allowedMethods.has(methodName)) return;

        if (node.parent?.type !== "CallExpression" || node.parent.callee !== node) return;

        context.report({
          node,
          message: `Destructure for clarity: \`const { ${methodName} } = ${hookSource}()\` then call \`${methodName}(...)\` directly — easier for React Compiler to memoize and clearer about which methods this component depends on`,
        });
      },
    };
  },
};
