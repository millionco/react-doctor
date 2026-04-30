import {
  GENERIC_EVENT_SUFFIXES,
  GIANT_COMPONENT_LINE_THRESHOLD,
  RENDER_FUNCTION_PATTERN,
} from "../constants.js";
import { isComponentAssignment, isComponentDeclaration, isUppercaseName } from "../helpers.js";
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
const BOOLEAN_PROP_THRESHOLD = 4;

// HACK: components with many boolean props (isLoading, hasIcon, showHeader,
// canEdit...) typically signal "many UI variants jammed into one component"
// — a sign that the component should be split via composition (compound
// components, explicit variant components). We use a name-based heuristic
// because TypeScript types aren't visible at this AST layer.
export const noManyBooleanProps: Rule = {
  create: (context: RuleContext) => {
    const checkParam = (param: EsTreeNode, componentName: string, reportNode: EsTreeNode): void => {
      if (param.type !== "ObjectPattern") return;
      const booleanLikePropNames: string[] = [];
      for (const property of param.properties ?? []) {
        if (property.type !== "Property") continue;
        const keyName = property.key?.type === "Identifier" ? property.key.name : null;
        if (!keyName) continue;
        if (BOOLEAN_PROP_PREFIX_PATTERN.test(keyName)) {
          booleanLikePropNames.push(keyName);
        }
      }
      if (booleanLikePropNames.length >= BOOLEAN_PROP_THRESHOLD) {
        context.report({
          node: reportNode,
          message: `Component "${componentName}" takes ${booleanLikePropNames.length} boolean-like props (${booleanLikePropNames.slice(0, 3).join(", ")}…) — consider compound components or explicit variants instead of stacking flags`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!isComponentDeclaration(node)) return;
        const firstParam = node.params?.[0];
        if (!firstParam) return;
        checkParam(firstParam, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        const firstParam = node.init?.params?.[0];
        if (!firstParam) return;
        checkParam(firstParam, node.id.name, node.id);
      },
    };
  },
};

// HACK: React 19+ deprecated `forwardRef` (refs are now regular props on
// function components) and `useContext` (replaced by the more flexible
// `use()`). Continuing to import them works on 19 but blocks adopting the
// cleaner APIs and adds type/runtime indirection.
const REACT_19_DEPRECATED_NAMED_IMPORTS = new Set(["forwardRef"]);

export const noReact19DeprecatedApis: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react") return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        const importedName = specifier.imported?.name;
        if (!importedName) continue;
        if (REACT_19_DEPRECATED_NAMED_IMPORTS.has(importedName)) {
          context.report({
            node: specifier,
            message: `${importedName} is no longer needed on React 19+ — refs are regular props on function components; remove forwardRef and pass ref directly`,
          });
        }
      }
    },
  }),
};
