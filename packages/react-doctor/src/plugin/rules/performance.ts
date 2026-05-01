import {
  ANIMATION_CALLBACK_NAMES,
  BLUR_VALUE_PATTERN,
  EFFECT_HOOK_NAMES,
  EXECUTABLE_SCRIPT_TYPES,
  LARGE_BLUR_THRESHOLD_PX,
  LAYOUT_PROPERTIES,
  LOADING_STATE_PATTERN,
  MOTION_ANIMATE_PROPS,
  SCRIPT_LOADING_ATTRIBUTES,
} from "../constants.js";
import {
  getEffectCallback,
  isComponentAssignment,
  isHookCall,
  isMemberProperty,
  isSetterCall,
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

// Identifiers and member-access chains are technically "simple", but memoizing
// them is sometimes intentional (stable reference passing). Only flag arithmetic
// / literal trivial cases to keep false positives low.
const isTriviallyCheapExpression = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  if (!isSimpleExpression(node)) return false;
  if (node.type === "Identifier") return false;
  if (node.type === "MemberExpression") return false;
  return true;
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

      if (returnExpression && isTriviallyCheapExpression(returnExpression)) {
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
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const bodyStatements =
        callback.body?.type === "BlockStatement" ? callback.body.body : [callback.body];
      if (!bodyStatements || bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (soleStatement?.type === "ExpressionStatement" && isSetterCall(soleStatement.expression)) {
        context.report({
          node,
          message:
            "useEffect(setState, []) on mount causes a flash — consider useSyncExternalStore or suppressHydrationWarning",
        });
      }
    },
  }),
};

export const renderingScriptDeferAsync: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "script") return;

      const attributes = node.attributes ?? [];
      const hasSrc = attributes.some(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          attr.name.name === "src",
      );

      if (!hasSrc) return;

      const typeAttribute = attributes.find(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          attr.name.name === "type",
      );
      const typeValue = typeAttribute?.value?.type === "Literal" ? typeAttribute.value.value : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;
      if (typeValue === "module") return;

      const hasLoadingStrategy = attributes.some(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          SCRIPT_LOADING_ATTRIBUTES.has(attr.name.name),
      );

      if (!hasLoadingStrategy) {
        context.report({
          node,
          message:
            "<script src> without defer or async — blocks HTML parsing and delays First Contentful Paint. Add defer for DOM-dependent scripts or async for independent ones",
        });
      }
    },
  }),
};

// HACK: detect static JSX declared inside a component body — anything like
// `const Header = <h1>Hi</h1>` inside a render function gets recreated on
// every render. If the JSX has no expression containers referencing local
// scope (no props, no state), it can be hoisted to module scope.
const jsxReferencesLocalScope = (jsxNode: EsTreeNode): boolean => {
  let referencesScope = false;
  walkAst(jsxNode, (child: EsTreeNode) => {
    if (referencesScope) return;
    if (
      child.type === "JSXExpressionContainer" &&
      child.expression?.type !== "JSXEmptyExpression"
    ) {
      referencesScope = true;
    }
    if (child.type === "JSXSpreadAttribute") {
      referencesScope = true;
    }
  });
  return referencesScope;
};

export const renderingHoistJsx: Rule = {
  create: (context: RuleContext) => {
    let componentDepth = 0;

    const isComponentLike = (node: EsTreeNode): boolean => {
      if (node.type === "FunctionDeclaration" && node.id?.name && isUppercaseName(node.id.name)) {
        return true;
      }
      if (node.type === "VariableDeclarator" && isComponentAssignment(node)) {
        return true;
      }
      return false;
    };

    const enter = (node: EsTreeNode): void => {
      if (isComponentLike(node)) componentDepth++;
    };
    const exit = (node: EsTreeNode): void => {
      if (isComponentLike(node)) componentDepth = Math.max(0, componentDepth - 1);
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      VariableDeclarator: enter,
      "VariableDeclarator:exit": exit,
      VariableDeclaration(node: EsTreeNode) {
        if (componentDepth === 0) return;
        if (node.kind !== "const") return;
        for (const declarator of node.declarations ?? []) {
          const init = declarator.init;
          if (!init) continue;
          if (init.type !== "JSXElement" && init.type !== "JSXFragment") continue;
          if (jsxReferencesLocalScope(init)) continue;
          const name = declarator.id?.type === "Identifier" ? declarator.id.name : "<unnamed>";
          context.report({
            node: declarator,
            message: `Static JSX "${name}" inside a component — hoist to module scope so it isn't recreated each render`,
          });
        }
      },
    };
  },
};

const callbackReturnsJsx = (callback: EsTreeNode | undefined): boolean => {
  if (!callback) return false;
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
    return false;
  }
  const body = callback.body;
  if (body?.type === "JSXElement" || body?.type === "JSXFragment") return true;
  if (body?.type !== "BlockStatement") return false;
  for (const stmt of body.body ?? []) {
    if (
      stmt.type === "ReturnStatement" &&
      (stmt.argument?.type === "JSXElement" || stmt.argument?.type === "JSXFragment")
    ) {
      return true;
    }
  }
  return false;
};

const containsEarlyReturn = (ifStatement: EsTreeNode): boolean => {
  const consequent = ifStatement.consequent;
  if (!consequent) return false;
  if (consequent.type === "ReturnStatement") return true;
  if (consequent.type !== "BlockStatement") return false;
  for (const stmt of consequent.body ?? []) {
    if (stmt.type === "ReturnStatement") return true;
  }
  return false;
};

// HACK: `useMemo(() => <jsx/>)` followed by an early return wastes the
// memoization — the useMemo callback runs every render even when the
// component bails out (loading, gated, etc.). Better to extract the JSX
// into a memoized child component so the parent's early return
// short-circuits before the child renders.
export const rerenderMemoBeforeEarlyReturn: Rule = {
  create: (context: RuleContext) => {
    const inspectFunctionBody = (statements: EsTreeNode[]): void => {
      let memoNode: EsTreeNode | null = null;

      for (const stmt of statements) {
        if (!memoNode) {
          if (stmt.type !== "VariableDeclaration") continue;
          for (const declarator of stmt.declarations ?? []) {
            const init = declarator.init;
            if (
              init?.type === "CallExpression" &&
              isHookCall(init, "useMemo") &&
              callbackReturnsJsx(init.arguments?.[0])
            ) {
              memoNode = declarator;
              break;
            }
          }
          continue;
        }
        if (stmt.type === "IfStatement" && containsEarlyReturn(stmt)) {
          context.report({
            node: memoNode,
            message:
              "useMemo returning JSX runs before an early return — extract the JSX into a memoized child component so the parent bails out before the subtree renders",
          });
          return;
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!isUppercaseName(node.id?.name ?? "")) return;
        if (node.body?.type !== "BlockStatement") return;
        inspectFunctionBody(node.body.body ?? []);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        const body = node.init?.body;
        if (body?.type !== "BlockStatement") return;
        inspectFunctionBody(body.body ?? []);
      },
    };
  },
};

const NONDETERMINISTIC_RENDER_PATTERNS: Array<{
  matches: (node: EsTreeNode) => boolean;
  display: string;
}> = [
  {
    display: "new Date()",
    matches: (n) =>
      n.type === "NewExpression" && n.callee?.type === "Identifier" && n.callee.name === "Date",
  },
  {
    display: "Date.now()",
    matches: (n) =>
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.object?.type === "Identifier" &&
      n.callee.object.name === "Date" &&
      n.callee.property?.type === "Identifier" &&
      n.callee.property.name === "now",
  },
  {
    display: "Math.random()",
    matches: (n) =>
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.object?.type === "Identifier" &&
      n.callee.object.name === "Math" &&
      n.callee.property?.type === "Identifier" &&
      n.callee.property.name === "random",
  },
  {
    display: "performance.now()",
    matches: (n) =>
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.object?.type === "Identifier" &&
      n.callee.object.name === "performance" &&
      n.callee.property?.type === "Identifier" &&
      n.callee.property.name === "now",
  },
  {
    display: "crypto.randomUUID()",
    matches: (n) =>
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.object?.type === "Identifier" &&
      n.callee.object.name === "crypto" &&
      n.callee.property?.type === "Identifier" &&
      n.callee.property.name === "randomUUID",
  },
];

const findOpeningElementOfChild = (jsxNode: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = jsxNode.parent ?? null;
  while (cursor) {
    if (cursor.type === "JSXElement") return cursor.openingElement;
    if (cursor.type === "JSXFragment") return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasSuppressHydrationWarningAttribute = (openingElement: EsTreeNode | null): boolean => {
  if (!openingElement) return false;
  for (const attr of openingElement.attributes ?? []) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      attr.name.name === "suppressHydrationWarning"
    ) {
      return true;
    }
  }
  return false;
};

const HIGH_FREQUENCY_DOM_EVENTS = new Set([
  "scroll",
  "mousemove",
  "wheel",
  "pointermove",
  "touchmove",
  "drag",
]);

const isAddEventListenerCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type !== "MemberExpression") return false;
  if (node.callee.property?.type !== "Identifier") return false;
  if (node.callee.property.name !== "addEventListener") return false;
  return true;
};

const handlerCallsSetState = (handler: EsTreeNode): EsTreeNode | null => {
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") {
    return null;
  }
  let setStateCall: EsTreeNode | null = null;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (setStateCall) return;
    if (
      child.type === "CallExpression" &&
      child.callee?.type === "Identifier" &&
      /^set[A-Z]/.test(child.callee.name)
    ) {
      setStateCall = child;
    }
  });
  return setStateCall;
};

// HACK: scroll, mousemove, wheel, pointermove, and similar high-frequency
// DOM events fire dozens to hundreds of times per second. Calling
// `setState` from these handlers triggers a re-render on every event,
// pegging the JS thread and causing the user-visible jank these
// listeners were trying to react to. Use `useTransition`/`startTransition`
// to mark the update as non-urgent (so the browser can interrupt it for
// input), or stash the value in a ref + raf throttle, or use
// `useDeferredValue`.
export const rerenderTransitionsScroll: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isAddEventListenerCall(node)) return;
      const eventArg = node.arguments?.[0];
      if (eventArg?.type !== "Literal") return;
      const eventName = eventArg.value;
      if (typeof eventName !== "string" || !HIGH_FREQUENCY_DOM_EVENTS.has(eventName)) return;

      const handler = node.arguments?.[1];
      if (!handler) return;
      const setStateCall = handlerCallsSetState(handler);
      if (!setStateCall) return;

      // Skip if the setState is already wrapped in startTransition.
      let cursor: EsTreeNode | null = setStateCall.parent ?? null;
      while (cursor && cursor !== handler) {
        if (
          cursor.type === "CallExpression" &&
          cursor.callee?.type === "Identifier" &&
          (cursor.callee.name === "startTransition" ||
            cursor.callee.name === "requestAnimationFrame" ||
            cursor.callee.name === "requestIdleCallback")
        ) {
          return;
        }
        cursor = cursor.parent ?? null;
      }

      context.report({
        node: setStateCall,
        message: `setState in a "${eventName}" handler triggers re-renders at scroll/pointer frequency — wrap in startTransition (mark as non-urgent), use useDeferredValue, or stash in a ref + rAF throttle`,
      });
    },
  }),
};

// HACK: rendering `new Date()`, `Date.now()`, `Math.random()`, etc.
// directly inside JSX produces a different value on the server vs the
// client, causing React's hydration mismatch warning. The fix is either
// to wrap in `useEffect` + `useState` (so the dynamic value renders
// only client-side) or to add `suppressHydrationWarning` to the parent
// element when the mismatch is intentional.
export const renderingHydrationMismatchTime: Rule = {
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNode) {
      if (!node.expression) return;
      const matched = NONDETERMINISTIC_RENDER_PATTERNS.find((pattern) =>
        pattern.matches(node.expression),
      );
      // Direct call as the JSX child expression.
      if (matched) {
        const openingElement = findOpeningElementOfChild(node);
        if (hasSuppressHydrationWarningAttribute(openingElement)) return;
        context.report({
          node,
          message: `${matched.display} in JSX renders differently on server vs client — wrap in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional`,
        });
        return;
      }

      // Method-chained on a Date / Math / etc. — e.g. new Date().toLocaleString().
      walkAst(node.expression, (child: EsTreeNode) => {
        for (const pattern of NONDETERMINISTIC_RENDER_PATTERNS) {
          if (pattern.matches(child)) {
            const openingElement = findOpeningElementOfChild(node);
            if (hasSuppressHydrationWarningAttribute(openingElement)) return;
            context.report({
              node: child,
              message: `${pattern.display} reachable from JSX renders differently on server vs client — wrap in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional`,
            });
            return;
          }
        }
      });
    },
  }),
};

const collectIdentifierNames = (node: EsTreeNode | null | undefined, into: Set<string>): void => {
  if (!node) return;
  walkAst(node, (child: EsTreeNode) => {
    if (child.type === "Identifier") into.add(child.name);
  });
};

const isEarlyReturnIfStatement = (statement: EsTreeNode): boolean => {
  if (statement.type !== "IfStatement") return false;
  const consequent = statement.consequent;
  if (!consequent) return false;
  if (consequent.type === "ReturnStatement") return true;
  if (consequent.type !== "BlockStatement") return false;
  for (const inner of consequent.body ?? []) {
    if (inner.type === "ReturnStatement") return true;
  }
  return false;
};

// HACK: `const x = await something(); if (skip) return defaultValue;` —
// the early-return doesn't depend on the awaited value, so the await
// blocked the function for nothing on the skip path. Move the await
// after the cheap synchronous guard so we only pay the latency when we
// actually need the data.
//
// Heuristic: an awaited VariableDeclaration immediately followed by an
// IfStatement whose test references no identifiers from the awaited
// declaration. We require the if to be the very next statement to
// stay precise (intervening statements would imply the awaited binding
// is being prepared for use).
export const asyncDeferAwait: Rule = {
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const currentStatement = statements[statementIndex];
        if (currentStatement.type !== "VariableDeclaration") continue;

        const awaitedBindingNames = new Set<string>();
        let didAwait = false;
        for (const declarator of currentStatement.declarations ?? []) {
          if (declarator.init?.type === "AwaitExpression") {
            didAwait = true;
            if (declarator.id?.type === "Identifier") {
              awaitedBindingNames.add(declarator.id.name);
            } else if (declarator.id?.type === "ObjectPattern") {
              for (const property of declarator.id.properties ?? []) {
                if (property.type === "Property" && property.value?.type === "Identifier") {
                  awaitedBindingNames.add(property.value.name);
                }
              }
            }
          }
        }
        if (!didAwait) continue;

        const nextStatement = statements[statementIndex + 1];
        if (!isEarlyReturnIfStatement(nextStatement)) continue;

        const testIdentifiers = new Set<string>();
        collectIdentifierNames(nextStatement.test, testIdentifiers);
        const usesAwaitedBinding = [...awaitedBindingNames].some((name) =>
          testIdentifiers.has(name),
        );
        if (usesAwaitedBinding) continue;

        const consequentIdentifiers = new Set<string>();
        collectIdentifierNames(nextStatement.consequent, consequentIdentifiers);
        const consequentUsesAwaited = [...awaitedBindingNames].some((name) =>
          consequentIdentifiers.has(name),
        );
        if (consequentUsesAwaited) continue;

        context.report({
          node: currentStatement,
          message:
            "await blocks the function before an early-return that doesn't use the awaited value — move the await after the synchronous guard so the skip path stays fast",
        });
      }
    };

    const enterFunction = (node: EsTreeNode): void => {
      if (!node.async) return;
      if (node.body?.type !== "BlockStatement") return;
      inspectStatements(node.body.body ?? []);
    };

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
    };
  },
};

const CONTINUOUS_VALUE_HOOK_PATTERN =
  /^use(?:Window(?:Width|Height|Dimensions)|Scroll(?:Position|Y|X)|MousePosition|ResizeObserver|IntersectionObserver)/;

// HACK: hooks that return a continuously-changing numeric value
// (`useWindowWidth`, `useScrollPosition`, etc.) trigger a re-render on
// every change. If the component only cares about a coarser boolean
// derived from that value (`width < 768` → "is mobile"), it ends up
// rendering on every pixel of resize. Use a media-query / threshold
// hook (`useMediaQuery("(max-width: 767px)")`) which only fires when
// the threshold flips.
//
// Heuristic: `const x = useFooBar(...)` immediately followed by a
// `const y = x [<>=] literal` (or boolean expression on x), where y is
// the only value referenced in the JSX.
const isThresholdComparison = (node: EsTreeNode, valueName: string): boolean => {
  if (node.type !== "BinaryExpression") return false;
  if (!["<", "<=", ">", ">=", "===", "!==", "==", "!="].includes(node.operator)) return false;
  const referencesContinuous =
    (node.left?.type === "Identifier" && node.left.name === valueName) ||
    (node.right?.type === "Identifier" && node.right.name === valueName);
  if (!referencesContinuous) return false;
  return node.left?.type === "Literal" || node.right?.type === "Literal";
};

const findThresholdDerivedBindings = (
  componentBody: EsTreeNode,
): Array<{ continuousName: string; hookName: string; declarator: EsTreeNode }> => {
  const out: Array<{ continuousName: string; hookName: string; declarator: EsTreeNode }> = [];
  if (componentBody?.type !== "BlockStatement") return out;
  const statements = componentBody.body ?? [];

  for (let outerIndex = 0; outerIndex < statements.length; outerIndex++) {
    const outerStatement = statements[outerIndex];
    if (outerStatement.type !== "VariableDeclaration") continue;

    for (const declarator of outerStatement.declarations ?? []) {
      if (declarator.id?.type !== "Identifier") continue;
      const init = declarator.init;
      if (init?.type !== "CallExpression") continue;
      if (init.callee?.type !== "Identifier") continue;
      if (!CONTINUOUS_VALUE_HOOK_PATTERN.test(init.callee.name)) continue;

      const continuousName = declarator.id.name;
      const hookName = init.callee.name;

      // Look at the next statement(s) for a derived threshold binding.
      for (let innerIndex = outerIndex + 1; innerIndex < statements.length; innerIndex++) {
        const innerStatement = statements[innerIndex];
        if (innerStatement.type !== "VariableDeclaration") break;
        let foundThreshold = false;
        for (const innerDecl of innerStatement.declarations ?? []) {
          if (innerDecl.init && isThresholdComparison(innerDecl.init, continuousName)) {
            foundThreshold = true;
            break;
          }
        }
        if (foundThreshold) {
          out.push({ continuousName, hookName, declarator });
          break;
        }
      }
    }
  }
  return out;
};

export const rerenderDerivedStateFromHook: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || componentBody.type !== "BlockStatement") return;
      const bindings = findThresholdDerivedBindings(componentBody);
      for (const binding of bindings) {
        context.report({
          node: binding.declarator,
          message: `${binding.hookName}() returns a continuously-changing value but you only compare it to a threshold — use a media-query / threshold hook (e.g. \`useMediaQuery("(max-width: 767px)")\`) so the component re-renders only when the threshold flips`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};
