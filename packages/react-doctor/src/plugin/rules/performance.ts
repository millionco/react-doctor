import {
  ANIMATION_CALLBACK_NAMES,
  BLUR_VALUE_PATTERN,
  EFFECT_HOOK_NAMES,
  LARGE_BLUR_THRESHOLD_PX,
  LAYOUT_PROPERTIES,
  LOADING_STATE_PATTERN,
  MOTION_ANIMATE_PROPS,
  SETTER_PATTERN,
} from "../constants.js";
import {
  getEffectCallback,
  isComponentAssignment,
  isHookCall,
  isMemberProperty,
  isSimpleExpression,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const isMemoCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type === "Identifier" && node.callee.name === "memo") return true;
  if (
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "React" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "memo"
  )
    return true;
  return false;
};

const isInlineReference = (node: EsTreeNode): string | null => {
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    (node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.property?.name === "bind")
  )
    return "functions";

  if (node.type === "ObjectExpression") return "objects";
  if (node.type === "ArrayExpression") return "Arrays";
  if (node.type === "JSXElement" || node.type === "JSXFragment") return "JSX";

  return null;
};

const getInlineLiteralKind = (node: EsTreeNode): "object" | "array" | null => {
  if (node.type === "ObjectExpression") return "object";
  if (node.type === "ArrayExpression") return "array";
  return null;
};

export const noInlineObjectProps: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const inlineLiteralKind = getInlineLiteralKind(node.value.expression);
      if (!inlineLiteralKind) return;

      const propName =
        node.name?.type === "JSXIdentifier" ? node.name.name : "this prop";

      context.report({
        node: node.value.expression,
        message: `Inline ${inlineLiteralKind} literal passed to "${propName}" creates a new reference on every render — extract it to a stable constant`,
      });
    },
  }),
};

export const noInlinePropOnMemoComponent: Rule = {
  create: (context: RuleContext) => {
    const memoizedComponentNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNode) {
        if (node.id?.type !== "Identifier" || !node.init) return;
        if (isMemoCall(node.init)) {
          memoizedComponentNames.add(node.id.name);
        }
      },
      ExportDefaultDeclaration(node: EsTreeNode) {
        if (node.declaration && isMemoCall(node.declaration)) {
          const innerArgument = node.declaration.arguments?.[0];
          if (innerArgument?.type === "Identifier") {
            memoizedComponentNames.add(innerArgument.name);
          }
        }
      },
      JSXAttribute(node: EsTreeNode) {
        if (!node.value || node.value.type !== "JSXExpressionContainer") return;

        const openingElement = node.parent;
        if (!openingElement || openingElement.type !== "JSXOpeningElement") return;

        let elementName: string | null = null;
        if (openingElement.name?.type === "JSXIdentifier") {
          elementName = openingElement.name.name;
        }
        if (!elementName || !memoizedComponentNames.has(elementName)) return;

        const propType = isInlineReference(node.value.expression);
        if (propType) {
          context.report({
            node: node.value.expression,
            message: `JSX attribute values should not contain ${propType} created in the same scope — ${elementName} is wrapped in memo(), so new references cause unnecessary re-renders`,
          });
        }
      },
    };
  },
};

export const noUsememoSimpleExpression: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, "useMemo")) return;

      const callback = node.arguments?.[0];
      if (!callback) return;
      if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
        return;

      let returnExpression = null;
      if (callback.body?.type !== "BlockStatement") {
        returnExpression = callback.body;
      } else if (
        callback.body.body?.length === 1 &&
        callback.body.body[0].type === "ReturnStatement"
      ) {
        returnExpression = callback.body.body[0].argument;
      }

      if (returnExpression && isSimpleExpression(returnExpression)) {
        context.report({
          node,
          message:
            "useMemo wrapping a trivially cheap expression — memo overhead exceeds the computation",
        });
      }
    },
  }),
};

const isMotionElement = (attributeNode: EsTreeNode): boolean => {
  const openingElement = attributeNode.parent;
  if (!openingElement || openingElement.type !== "JSXOpeningElement") return false;

  const elementName = openingElement.name;
  if (
    elementName?.type === "JSXMemberExpression" &&
    elementName.object?.type === "JSXIdentifier" &&
    (elementName.object.name === "motion" || elementName.object.name === "m")
  )
    return true;

  if (elementName?.type === "JSXIdentifier" && elementName.name.startsWith("Motion")) return true;

  return false;
};

export const noLayoutPropertyAnimation: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || !MOTION_ANIMATE_PROPS.has(node.name.name)) return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;
      if (isMotionElement(node)) return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        let propertyName = null;
        if (property.key?.type === "Identifier") {
          propertyName = property.key.name;
        } else if (property.key?.type === "Literal") {
          propertyName = property.key.value;
        }

        if (propertyName && LAYOUT_PROPERTIES.has(propertyName)) {
          context.report({
            node: property,
            message: `Animating layout property "${propertyName}" triggers layout recalculation every frame — use transform/scale or the layout prop`,
          });
        }
      }
    },
  }),
};

export const noTransitionAll: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "transition") continue;

        if (
          property.value?.type === "Literal" &&
          typeof property.value.value === "string" &&
          property.value.value.startsWith("all")
        ) {
          context.report({
            node: property,
            message:
              'transition: "all" animates every property including layout — list only the properties you animate',
          });
        }
      }
    },
  }),
};

export const noGlobalCssVariableAnimation: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier") return;
      if (!ANIMATION_CALLBACK_NAMES.has(node.callee.name)) return;

      const callback = node.arguments?.[0];
      if (!callback) return;

      const calleeName = node.callee.name;
      walkAst(callback, (child: EsTreeNode) => {
        if (child.type !== "CallExpression") return;
        if (!isMemberProperty(child.callee, "setProperty")) return;
        if (child.arguments?.[0]?.type !== "Literal") return;

        const variableName = child.arguments[0].value;
        if (typeof variableName !== "string" || !variableName.startsWith("--")) return;

        context.report({
          node: child,
          message: `CSS variable "${variableName}" updated in ${calleeName} — forces style recalculation on all inheriting elements every frame`,
        });
      });
    },
  }),
};

export const noLargeAnimatedBlur: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "style" && !MOTION_ANIMATE_PROPS.has(node.name.name)) return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "filter" && key !== "backdropFilter" && key !== "WebkitBackdropFilter")
          continue;
        if (property.value?.type !== "Literal" || typeof property.value.value !== "string")
          continue;

        const match = BLUR_VALUE_PATTERN.exec(property.value.value);
        if (!match) continue;

        const blurRadius = Number.parseFloat(match[1]);
        if (blurRadius > LARGE_BLUR_THRESHOLD_PX) {
          context.report({
            node: property,
            message: `blur(${blurRadius}px) is expensive — cost escalates with radius and layer size, can exceed GPU memory on mobile`,
          });
        }
      }
    },
  }),
};

export const noScaleFromZero: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "initial" && node.name.name !== "exit") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "scale") continue;

        if (property.value?.type === "Literal" && property.value.value === 0) {
          context.report({
            node: property,
            message:
              "scale: 0 makes elements appear from nowhere — use scale: 0.95 with opacity: 0 for natural entrance",
          });
        }
      }
    },
  }),
};

export const noPermanentWillChange: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "willChange") continue;

        context.report({
          node: property,
          message:
            "Permanent will-change wastes GPU memory — apply only during active animation and remove after",
        });
      }
    },
  }),
};

export const rerenderMemoWithDefaultValue: Rule = {
  create: (context: RuleContext) => {
    const checkDefaultProps = (params: EsTreeNode[]): void => {
      for (const param of params) {
        if (param.type !== "ObjectPattern") continue;
        for (const property of param.properties ?? []) {
          if (property.type !== "Property" || property.value?.type !== "AssignmentPattern")
            continue;
          const defaultValue = property.value.right;
          if (defaultValue?.type === "ObjectExpression" && defaultValue.properties?.length === 0) {
            context.report({
              node: defaultValue,
              message:
                "Default prop value {} creates a new object reference every render — extract to a module-level constant",
            });
          }
          if (defaultValue?.type === "ArrayExpression" && defaultValue.elements?.length === 0) {
            context.report({
              node: defaultValue,
              message:
                "Default prop value [] creates a new array reference every render — extract to a module-level constant",
            });
          }
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkDefaultProps(node.params ?? []);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkDefaultProps(node.init.params ?? []);
      },
    };
  },
};

export const renderingAnimateSvgWrapper: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "svg") return;

      const hasAnimationProp = node.attributes?.some(
        (attribute: EsTreeNode) =>
          attribute.type === "JSXAttribute" &&
          attribute.name?.type === "JSXIdentifier" &&
          MOTION_ANIMATE_PROPS.has(attribute.name.name),
      );

      if (hasAnimationProp) {
        context.report({
          node,
          message:
            "Animation props directly on <svg> — wrap in a <div> or <motion.div> for better rendering performance",
        });
      }
    },
  }),
};

export const renderingUsetransitionLoading: Rule = {
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNode) {
      if (node.id?.type !== "ArrayPattern" || !node.id.elements?.length) return;
      if (!node.init || !isHookCall(node.init, "useState")) return;
      if (!node.init.arguments?.length) return;

      const initializer = node.init.arguments[0];
      if (initializer.type !== "Literal" || initializer.value !== false) return;

      const stateVariableName = node.id.elements[0]?.name;
      if (!stateVariableName || !LOADING_STATE_PATTERN.test(stateVariableName)) return;

      context.report({
        node: node.init,
        message: `useState for "${stateVariableName}" — if this guards a state transition (not an async fetch), consider useTransition instead`,
      });
    },
  }),
};

export const renderingHydrationNoFlicker: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || node.arguments?.length < 2) return;

      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const bodyStatements =
        callback.body?.type === "BlockStatement" ? callback.body.body : [callback.body];
      if (!bodyStatements || bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (
        soleStatement?.type === "ExpressionStatement" &&
        soleStatement.expression?.type === "CallExpression" &&
        soleStatement.expression.callee?.type === "Identifier" &&
        SETTER_PATTERN.test(soleStatement.expression.callee.name)
      ) {
        context.report({
          node,
          message:
            "useEffect(setState, []) on mount causes a flash — consider useSyncExternalStore or suppressHydrationWarning",
        });
      }
    },
  }),
};
