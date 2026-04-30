import {
  DEPRECATED_RN_MODULE_REPLACEMENTS,
  LEGACY_EXPO_PACKAGE_REPLACEMENTS,
  LEGACY_SHADOW_STYLE_PROPERTIES,
  RAW_TEXT_PREVIEW_MAX_CHARS,
  REACT_NATIVE_LIST_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENT_KEYWORDS,
} from "../constants.js";
import { hasDirective, isMemberProperty, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const resolveJsxElementName = (openingElement: EsTreeNode): string | null => {
  const elementName = openingElement?.name;
  if (!elementName) return null;
  if (elementName.type === "JSXIdentifier") return elementName.name;
  if (elementName.type === "JSXMemberExpression") return elementName.property?.name ?? null;
  return null;
};

const truncateText = (text: string): string =>
  text.length > RAW_TEXT_PREVIEW_MAX_CHARS
    ? `${text.slice(0, RAW_TEXT_PREVIEW_MAX_CHARS)}...`
    : text;

const isRawTextContent = (child: EsTreeNode): boolean => {
  if (child.type === "JSXText") return Boolean(child.value?.trim());
  if (child.type !== "JSXExpressionContainer" || !child.expression) return false;

  const expression = child.expression;
  return (
    (expression.type === "Literal" &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    expression.type === "TemplateLiteral"
  );
};

const getRawTextDescription = (child: EsTreeNode): string => {
  if (child.type === "JSXText") {
    return `"${truncateText(child.value.trim())}"`;
  }

  if (child.type === "JSXExpressionContainer" && child.expression) {
    const expression = child.expression;
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return `"${truncateText(expression.value)}"`;
    }
    if (expression.type === "Literal" && typeof expression.value === "number") {
      return `{${expression.value}}`;
    }
    if (expression.type === "TemplateLiteral") return "template literal";
  }

  return "text content";
};

const isTextHandlingComponent = (elementName: string): boolean => {
  if (REACT_NATIVE_TEXT_COMPONENTS.has(elementName)) return true;
  return [...REACT_NATIVE_TEXT_COMPONENT_KEYWORDS].some((keyword) => elementName.includes(keyword));
};

export const rnNoRawText: Rule = {
  create: (context: RuleContext) => {
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNode) {
        isDomComponentFile = hasDirective(programNode, "use dom");
      },
      JSXElement(node: EsTreeNode) {
        if (isDomComponentFile) return;

        const elementName = resolveJsxElementName(node.openingElement);
        if (elementName && isTextHandlingComponent(elementName)) return;

        for (const child of node.children ?? []) {
          if (!isRawTextContent(child)) continue;

          context.report({
            node: child,
            message: `Raw ${getRawTextDescription(child)} outside a <Text> component — this will crash on React Native`,
          });
        }
      },
    };
  },
};

export const rnNoDeprecatedModules: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        const importedName = specifier.imported?.name;
        if (!importedName) continue;

        const replacement = DEPRECATED_RN_MODULE_REPLACEMENTS[importedName];
        if (!replacement) continue;

        context.report({
          node: specifier,
          message: `"${importedName}" was removed from react-native — use ${replacement} instead`,
        });
      }
    },
  }),
};

export const rnNoLegacyExpoPackages: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      for (const [packageName, replacement] of Object.entries(LEGACY_EXPO_PACKAGE_REPLACEMENTS)) {
        if (source === packageName || source.startsWith(`${packageName}/`)) {
          context.report({
            node,
            message: `"${packageName}" is deprecated — use ${replacement}`,
          });
          return;
        }
      }
    },
  }),
};

export const rnNoDimensionsGet: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "Dimensions")
        return;

      if (isMemberProperty(node.callee, "get")) {
        context.report({
          node,
          message:
            "Dimensions.get() does not update on screen rotation or resize — use useWindowDimensions() for reactive layout",
        });
      }

      if (isMemberProperty(node.callee, "addEventListener")) {
        context.report({
          node,
          message:
            "Dimensions.addEventListener() was removed in React Native 0.72 — use useWindowDimensions() instead",
        });
      }
    },
  }),
};

export const rnNoInlineFlatlistRenderitem: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "renderItem") return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const openingElement = node.parent;
      if (!openingElement || openingElement.type !== "JSXOpeningElement") return;

      const listComponentName = resolveJsxElementName(openingElement);
      if (!listComponentName || !REACT_NATIVE_LIST_COMPONENTS.has(listComponentName)) return;

      const expression = node.value.expression;
      if (
        expression?.type !== "ArrowFunctionExpression" &&
        expression?.type !== "FunctionExpression"
      )
        return;

      context.report({
        node: expression,
        message: `Inline renderItem on <${listComponentName}> creates a new function reference every render — extract to a named function or wrap in useCallback`,
      });
    },
  }),
};

const reportLegacyShadowProperties = (objectExpression: EsTreeNode, context: RuleContext): void => {
  const legacyShadowPropertyNames: string[] = [];

  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    const propertyName = property.key?.type === "Identifier" ? property.key.name : null;
    if (propertyName && LEGACY_SHADOW_STYLE_PROPERTIES.has(propertyName)) {
      legacyShadowPropertyNames.push(propertyName);
    }
  }

  if (legacyShadowPropertyNames.length === 0) return;

  const quotedPropertyNames = legacyShadowPropertyNames.map((name) => `"${name}"`).join(", ");
  context.report({
    node: objectExpression,
    message: `Legacy shadow style${legacyShadowPropertyNames.length > 1 ? "s" : ""} ${quotedPropertyNames} — use boxShadow for cross-platform shadows on the new architecture`,
  });
};

export const rnNoLegacyShadowStyles: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;

      if (expression?.type === "ObjectExpression") {
        reportLegacyShadowProperties(expression, context);
      } else if (expression?.type === "ArrayExpression") {
        for (const element of expression.elements ?? []) {
          if (element?.type === "ObjectExpression") {
            reportLegacyShadowProperties(element, context);
          }
        }
      }
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "StyleSheet")
        return;
      if (!isMemberProperty(node.callee, "create")) return;

      const stylesArgument = node.arguments?.[0];
      if (stylesArgument?.type !== "ObjectExpression") return;

      for (const styleDefinition of stylesArgument.properties ?? []) {
        if (styleDefinition.type !== "Property") continue;
        if (styleDefinition.value?.type !== "ObjectExpression") continue;
        reportLegacyShadowProperties(styleDefinition.value, context);
      }
    },
  }),
};

export const rnPreferReanimated: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.imported?.name !== "Animated") continue;

        context.report({
          node: specifier,
          message:
            "Animated from react-native runs animations on the JS thread — use react-native-reanimated for performant UI-thread animations",
        });
      }
    },
  }),
};

export const rnNoSingleElementStyleArray: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const propName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!propName) return;
      if (propName !== "style" && !propName.endsWith("Style")) return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ArrayExpression") return;
      if (expression.elements?.length !== 1) return;

      context.report({
        node: expression,
        message: `Single-element style array on "${propName}" — use ${propName}={value} instead of ${propName}={[value]} to avoid unnecessary array allocation`,
      });
    },
  }),
};

const TOUCHABLE_COMPONENTS = new Set([
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
]);

// HACK: TouchableOpacity / TouchableHighlight / TouchableWithoutFeedback /
// TouchableNativeFeedback are legacy and feature-frozen. Pressable is the
// modern, more configurable, more accessible replacement that works the
// same on iOS, Android, and Fabric.
export const rnPreferPressable: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        const importedName = specifier.imported?.name;
        if (!importedName || !TOUCHABLE_COMPONENTS.has(importedName)) continue;
        context.report({
          node: specifier,
          message: `${importedName} is legacy — use <Pressable> from react-native (or react-native-gesture-handler) for modern press handling`,
        });
      }
    },
  }),
};

// HACK: react-native's built-in <Image> has no caching, no placeholders,
// no progressive loading, and no priority hints. expo-image is a drop-in
// replacement (same prop API plus more) with disk + memory caching, blur
// placeholders, and crossfades — a major perceived-perf win for any list
// or hero image.
export const rnPreferExpoImage: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.imported?.name !== "Image") continue;
        context.report({
          node: specifier,
          message:
            "Importing Image from react-native — prefer expo-image for caching, placeholders, and progressive loading (drop-in API)",
        });
      }
    },
  }),
};

const NON_NATIVE_NAVIGATOR_PACKAGES = new Set([
  "@react-navigation/stack",
  "@react-navigation/drawer",
]);

// HACK: @react-navigation/stack uses a JS-implemented stack with
// imperfect native gesture/feel. native-stack (and native-tabs in v7+)
// uses platform-native UINavigationController / Fragment, giving real
// iOS/Android transitions, swipe-back, and large titles for free.
export const rnNoNonNativeNavigator: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (typeof source !== "string" || !NON_NATIVE_NAVIGATOR_PACKAGES.has(source)) return;
      const replacement = source.replace("@react-navigation/", "@react-navigation/native-");
      context.report({
        node,
        message: `${source} uses a JS-implemented navigator — use ${replacement} for native iOS/Android transitions and gestures`,
      });
    },
  }),
};

// HACK: setting React state inside an onScroll handler triggers a re-render
// at scroll-event frequency (60-120Hz). Use a Reanimated shared value
// (useSharedValue + useAnimatedScrollHandler) or a ref + raf throttle so
// the JS thread isn't pegged.
export const rnNoScrollState: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "onScroll") return;
      if (node.value?.type !== "JSXExpressionContainer") return;
      const expression = node.value.expression;
      if (
        expression?.type !== "ArrowFunctionExpression" &&
        expression?.type !== "FunctionExpression"
      ) {
        return;
      }

      let setStateCallNode: EsTreeNode | null = null;
      walkAst(expression.body, (child: EsTreeNode) => {
        if (setStateCallNode) return;
        if (
          child.type === "CallExpression" &&
          child.callee?.type === "Identifier" &&
          /^set[A-Z]/.test(child.callee.name)
        ) {
          setStateCallNode = child;
        }
      });

      if (setStateCallNode) {
        context.report({
          node: setStateCallNode,
          message:
            "setState in onScroll triggers re-renders on every scroll event — use a Reanimated shared value (useAnimatedScrollHandler) or a ref to track scroll position",
        });
      }
    },
  }),
};

// HACK: short-name only. `resolveJsxElementName` (defined at top of
// file) returns the property name for JSXMemberExpression — e.g.
// `Animated.ScrollView` resolves to `"ScrollView"`, which is what all
// the existing `REACT_NATIVE_*` sets use. Allowlists below use the same
// short-name form.
const SCROLLVIEW_NAMES = new Set(["ScrollView"]);

// HACK: <ScrollView>{items.map(...)}</ScrollView> renders every row in
// memory — for any list longer than ~10 items this destroys scroll
// performance on lower-end devices. FlashList / LegendList / FlatList
// recycle row components and only mount the visible window. The cost
// of switching is tiny (same prop API) and the perf win is huge.
export const rnNoScrollviewMappedList: Rule = {
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (!elementName || !SCROLLVIEW_NAMES.has(elementName)) return;

      for (const child of node.children ?? []) {
        if (child.type !== "JSXExpressionContainer") continue;
        const expression = child.expression;
        if (
          expression?.type === "CallExpression" &&
          expression.callee?.type === "MemberExpression" &&
          expression.callee.property?.type === "Identifier" &&
          expression.callee.property.name === "map"
        ) {
          context.report({
            node: child,
            message: `<${elementName}> rendering items.map(...) — use FlashList, LegendList, or FlatList so only visible rows mount`,
          });
          return;
        }
      }
    },
  }),
};

const RENDER_ITEM_PROP_NAMES = new Set([
  "renderItem",
  "renderSectionHeader",
  "renderSectionFooter",
]);

// HACK: inside `renderItem`, JSX prop values that are object literals
// (`style={{...}}`, `user={{...}}`, etc.) allocate a fresh object
// reference per row. Any `memo()`-wrapped row component bails its
// shallow-compare for that prop and rerenders even when the underlying
// data didn't change. Hoist the object outside renderItem (StyleSheet,
// constant, useMemo at list scope) or pass primitives into the row.
export const rnNoInlineObjectInListItem: Rule = {
  create: (context: RuleContext) => {
    let renderItemDepth = 0;

    const isRenderItemAttribute = (parent: EsTreeNode | undefined): boolean => {
      if (parent?.type !== "JSXAttribute") return false;
      const attrName = parent.name?.type === "JSXIdentifier" ? parent.name.name : null;
      return attrName ? RENDER_ITEM_PROP_NAMES.has(attrName) : false;
    };

    const isRenderItemFunction = (node: EsTreeNode): boolean => {
      if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
        return false;
      }
      // Walk up: parent should be JSXExpressionContainer whose parent is JSXAttribute renderItem.
      const expressionContainer = node.parent;
      if (expressionContainer?.type !== "JSXExpressionContainer") return false;
      return isRenderItemAttribute(expressionContainer.parent);
    };

    const enter = (node: EsTreeNode): void => {
      if (isRenderItemFunction(node)) renderItemDepth++;
    };
    const exit = (node: EsTreeNode): void => {
      if (isRenderItemFunction(node)) renderItemDepth = Math.max(0, renderItemDepth - 1);
    };

    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      JSXAttribute(node: EsTreeNode) {
        if (renderItemDepth === 0) return;
        if (node.value?.type !== "JSXExpressionContainer") return;
        if (node.value.expression?.type !== "ObjectExpression") return;
        const propName = node.name?.type === "JSXIdentifier" ? node.name.name : "<unknown>";
        context.report({
          node,
          message: `Inline object literal on "${propName}" inside renderItem — allocates a fresh reference per row and breaks memo() on the row component. Hoist outside renderItem or pass primitives`,
        });
      },
    };
  },
};

const REANIMATED_LAYOUT_KEYS = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
]);

const findReturnedObject = (callback: EsTreeNode): EsTreeNode | null => {
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
    return null;
  }
  const body = callback.body;
  if (body?.type === "ObjectExpression") return body;
  if (body?.type !== "BlockStatement") return null;
  for (const stmt of body.body ?? []) {
    if (stmt.type === "ReturnStatement" && stmt.argument?.type === "ObjectExpression") {
      return stmt.argument;
    }
  }
  return null;
};

// HACK: in Reanimated, `useAnimatedStyle(() => ({ height: …, width: … }))`
// runs the animation on the JS layout thread (or worse, triggers actual
// layout passes per frame). transform / opacity stay on the GPU
// compositor. For anything driven by `withTiming` / `withSpring` /
// shared values, animate `transform: [{ translateX/Y }, { scale }]` or
// `opacity` instead.
export const rnAnimateLayoutProperty: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier" || node.callee.name !== "useAnimatedStyle") return;
      const callback = node.arguments?.[0];
      if (!callback) return;
      const returnedObject = findReturnedObject(callback);
      if (!returnedObject) return;

      for (const property of returnedObject.properties ?? []) {
        if (property.type !== "Property") continue;
        if (property.key?.type !== "Identifier") continue;
        if (!REANIMATED_LAYOUT_KEYS.has(property.key.name)) continue;

        context.report({
          node: property,
          message: `useAnimatedStyle animating "${property.key.name}" — layout properties run on the layout thread; use transform: [{ translateX/Y }, { scale }] or opacity for GPU-accelerated animation`,
        });
      }
    },
  }),
};

// HACK: <SafeAreaView> wrapping <ScrollView> (or
// `useSafeAreaInsets()` + `paddingTop: insets.top` in
// `contentContainerStyle`) is the legacy way to handle safe areas.
// Modern RN exposes `contentInsetAdjustmentBehavior="automatic"` which
// the OS computes natively, integrating with sticky headers, large
// titles, and keyboard avoidance for free.
export const rnPreferContentInsetAdjustment: Rule = {
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (elementName !== "SafeAreaView") return;

      for (const child of node.children ?? []) {
        if (child.type !== "JSXElement") continue;
        const childName = resolveJsxElementName(child.openingElement);
        if (!childName || !SCROLLVIEW_NAMES.has(childName)) continue;

        context.report({
          node,
          message:
            '<SafeAreaView> wrapping <ScrollView> — set `contentInsetAdjustmentBehavior="automatic"` on the ScrollView and drop the SafeAreaView wrapper for native safe-area handling',
        });
        return;
      }
    },
  }),
};

const PRESS_HANDLER_PROP_NAMES = new Set(["onPressIn", "onPressOut"]);

const handlerMutatesIdentifier = (
  handler: EsTreeNode,
  sharedValueBindings: Set<string>,
): boolean => {
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") {
    return false;
  }
  if (sharedValueBindings.size === 0) return false;
  let didMutate = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (didMutate) return;
    if (
      child.type === "AssignmentExpression" &&
      child.left?.type === "MemberExpression" &&
      child.left.object?.type === "Identifier" &&
      sharedValueBindings.has(child.left.object.name) &&
      child.left.property?.type === "Identifier" &&
      child.left.property.name === "value"
    ) {
      didMutate = true;
    }
    if (
      child.type === "CallExpression" &&
      child.callee?.type === "MemberExpression" &&
      child.callee.object?.type === "Identifier" &&
      sharedValueBindings.has(child.callee.object.name) &&
      child.callee.property?.type === "Identifier" &&
      (child.callee.property.name === "set" || child.callee.property.name === "value")
    ) {
      didMutate = true;
    }
  });
  return didMutate;
};

// HACK: <Pressable onPressIn={() => sv.value = withTiming(0.95)}> bounces
// the gesture across the JS bridge twice (press in → JS handler → set
// shared value → animation kicks off), which is visibly stuttery on
// Android. The Reanimated GestureDetector + Gesture.Tap() runs entirely
// on the UI thread for native-feeling press feedback. We only flag when
// the receiver is actually a `useSharedValue` binding to avoid
// false-positives on `Map.prototype.set` / `ref.current.value =` etc.
export const rnPressableSharedValueMutation: Rule = {
  create: (context: RuleContext) => {
    const sharedValueBindingsByComponent: Array<Set<string>> = [];

    const enterScope = (): void => {
      sharedValueBindingsByComponent.push(new Set());
    };
    const exitScope = (): void => {
      sharedValueBindingsByComponent.pop();
    };
    const trackSharedValueBinding = (declarator: EsTreeNode): void => {
      if (sharedValueBindingsByComponent.length === 0) return;
      if (declarator.id?.type !== "Identifier") return;
      if (declarator.init?.type !== "CallExpression") return;
      const callee = declarator.init.callee;
      if (callee?.type !== "Identifier") return;
      if (callee.name !== "useSharedValue") return;
      sharedValueBindingsByComponent[sharedValueBindingsByComponent.length - 1].add(
        declarator.id.name,
      );
    };

    return {
      FunctionDeclaration: enterScope,
      "FunctionDeclaration:exit": exitScope,
      FunctionExpression: enterScope,
      "FunctionExpression:exit": exitScope,
      ArrowFunctionExpression: enterScope,
      "ArrowFunctionExpression:exit": exitScope,
      VariableDeclarator(node: EsTreeNode) {
        trackSharedValueBinding(node);
      },
      JSXOpeningElement(node: EsTreeNode) {
        const name = resolveJsxElementName(node);
        if (name !== "Pressable") return;
        if (sharedValueBindingsByComponent.length === 0) return;
        const activeBindings = new Set<string>();
        for (const frame of sharedValueBindingsByComponent) {
          for (const binding of frame) activeBindings.add(binding);
        }
        if (activeBindings.size === 0) return;

        for (const attr of node.attributes ?? []) {
          if (attr.type !== "JSXAttribute") continue;
          if (attr.name?.type !== "JSXIdentifier") continue;
          if (!PRESS_HANDLER_PROP_NAMES.has(attr.name.name)) continue;
          if (attr.value?.type !== "JSXExpressionContainer") continue;
          const handler = attr.value.expression;
          if (!handler) continue;
          if (!handlerMutatesIdentifier(handler, activeBindings)) continue;

          context.report({
            node: attr,
            message: `<Pressable> ${attr.name.name} mutates a Reanimated shared value — use a Gesture.Tap() inside <GestureDetector> for press animations that stay on the UI thread`,
          });
        }
      },
    };
  },
};

// Short-name form: resolveJsxElementName drops the `Animated.` prefix,
// so `<Animated.FlatList>` resolves to `"FlatList"` and matches here.
const VIRTUALIZED_LIST_NAMES = new Set([
  "FlatList",
  "FlashList",
  "LegendList",
  "SectionList",
  "VirtualizedList",
]);

// HACK: virtualized lists key off referential equality of `data`. Passing
// `data={items.map(...)}` allocates a fresh array on every parent render,
// which forces the list to re-key every row and bust its memo cache,
// destroying scroll perf. Hoist the transform into a useMemo at list
// scope or do the projection earlier in the parent.
export const rnListDataMapped: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !VIRTUALIZED_LIST_NAMES.has(elementName)) return;

      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier" || attr.name.name !== "data") continue;
        if (attr.value?.type !== "JSXExpressionContainer") continue;
        const expression = attr.value.expression;
        if (expression?.type !== "CallExpression") continue;
        if (expression.callee?.type !== "MemberExpression") continue;
        if (expression.callee.property?.type !== "Identifier") continue;
        const methodName = expression.callee.property.name;
        if (methodName !== "map" && methodName !== "filter") continue;

        context.report({
          node: attr,
          message: `<${elementName} data={items.${methodName}(...)}> allocates a fresh array per render — wrap in useMemo at list scope so the data reference stays stable across parent renders`,
        });
        return;
      }
    },
  }),
};

// HACK: useAnimatedReaction with a body that does nothing but assign to
// another shared value (`sv2.value = current`) is essentially what
// useDerivedValue is for. useDerivedValue is shorter, opts into the
// proper Reanimated dependency tracking, and avoids the side-effect
// gloss that useAnimatedReaction implies (it's meant for cross-thread
// reactions like calling runOnJS, not value derivation).
export const rnAnimationReactionAsDerived: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier" || node.callee.name !== "useAnimatedReaction") return;
      const reactionFn = node.arguments?.[1];
      if (!reactionFn) return;
      if (
        reactionFn.type !== "ArrowFunctionExpression" &&
        reactionFn.type !== "FunctionExpression"
      ) {
        return;
      }

      const body = reactionFn.body;

      // We only fire when the reaction body is EXACTLY one statement
      // and that statement is an assignment to another shared value's
      // `.value`. Any additional statement (console.log, function call,
      // condition, runOnJS, etc.) means useAnimatedReaction's
      // side-effect semantics are wanted; useDerivedValue would change
      // behavior.
      let singleAssignment: EsTreeNode | null = null;
      if (body?.type === "BlockStatement") {
        const statements = body.body ?? [];
        if (statements.length !== 1) return;
        const onlyStatement = statements[0];
        if (onlyStatement.type !== "ExpressionStatement") return;
        singleAssignment = onlyStatement.expression;
      } else if (body) {
        // Concise arrow body like `(cur) => sv.value = cur`.
        singleAssignment = body;
      }
      if (!singleAssignment) return;
      if (singleAssignment.type !== "AssignmentExpression") return;
      if (singleAssignment.left?.type !== "MemberExpression") return;
      if (singleAssignment.left.property?.type !== "Identifier") return;
      if (singleAssignment.left.property.name !== "value") return;

      context.report({
        node,
        message:
          "useAnimatedReaction body is a single shared-value assignment — useDerivedValue is shorter and tracks dependencies natively",
      });
    },
  }),
};

const JS_BOTTOM_SHEET_PACKAGES = new Set([
  "@gorhom/bottom-sheet",
  "react-native-bottom-sheet",
  "react-native-modal-bottom-sheet",
  "react-native-raw-bottom-sheet",
]);

// HACK: JS-implemented bottom sheets (gorhom/bottom-sheet et al.) do all
// their gesture handling and animation on the JS thread, which is laggy
// for the kind of velocity-tracking interactions a bottom sheet needs.
// React Native v7+ ships a native form sheet via <Modal presentationStyle=
// "formSheet"> that handles gestures, snap points, and detents on the
// platform's native modal stack.
export const rnBottomSheetPreferNative: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (typeof source !== "string" || !JS_BOTTOM_SHEET_PACKAGES.has(source)) return;
      context.report({
        node,
        message: `${source} is a JS-implemented bottom sheet — for v7+ RN, prefer <Modal presentationStyle="formSheet"> for native gesture handling and snap points`,
      });
    },
  }),
};

// HACK: dynamic `paddingBottom`/`paddingTop` on `contentContainerStyle`
// (e.g. `paddingBottom: keyboardHeight`) reflows the entire scroll
// content every time the value changes — the rows visually shift, and
// any sticky headers re-pin. The native equivalent is `contentInset`,
// which the platform applies as an OS-level offset without re-laying out
// the content.
export const rnScrollviewDynamicPadding: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node);
      if (!elementName) return;
      if (
        !SCROLLVIEW_NAMES.has(elementName) &&
        elementName !== "FlatList" &&
        elementName !== "FlashList"
      )
        return;

      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier" || attr.name.name !== "contentContainerStyle")
          continue;
        if (attr.value?.type !== "JSXExpressionContainer") continue;
        const expression = attr.value.expression;
        if (expression?.type !== "ObjectExpression") continue;

        for (const property of expression.properties ?? []) {
          if (property.type !== "Property") continue;
          if (property.key?.type !== "Identifier") continue;
          const key = property.key.name;
          if (key !== "paddingBottom" && key !== "paddingTop") continue;
          // Static numeric value is fine — only flag dynamic identifiers /
          // member expressions that change between renders.
          const value = property.value;
          if (!value) continue;
          if (value.type === "Literal") continue;

          context.report({
            node: property,
            message: `Dynamic ${key} on contentContainerStyle reflows the scroll content — use \`contentInset\` (OS-level offset, no relayout) instead`,
          });
          return;
        }
      }
    },
  }),
};

const LIST_ROW_PRESS_HANDLER_PROPS = new Set([
  "onPress",
  "onLongPress",
  "onPressIn",
  "onPressOut",
  "onSelect",
  "onClick",
]);

const detectInlineRowHandlers = (renderItemFn: EsTreeNode): EsTreeNode[] => {
  const inlineHandlers: EsTreeNode[] = [];
  walkAst(renderItemFn.body, (child: EsTreeNode) => {
    if (child.type !== "JSXAttribute") return;
    if (child.name?.type !== "JSXIdentifier") return;
    if (!LIST_ROW_PRESS_HANDLER_PROPS.has(child.name.name)) return;
    if (child.value?.type !== "JSXExpressionContainer") return;
    const expression = child.value.expression;
    if (
      expression?.type === "ArrowFunctionExpression" ||
      expression?.type === "FunctionExpression"
    ) {
      inlineHandlers.push(child);
    }
  });
  return inlineHandlers;
};

const isRenderItemJsxAttribute = (parent: EsTreeNode | undefined): boolean => {
  if (parent?.type !== "JSXAttribute") return false;
  const attrName = parent.name?.type === "JSXIdentifier" ? parent.name.name : null;
  return attrName === "renderItem";
};

const isRenderItemFunction = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (parent?.type !== "JSXExpressionContainer") return false;
  return isRenderItemJsxAttribute(parent.parent);
};

// HACK: every row of a virtualized list invokes its `renderItem`
// function — and any `() => onPress(item.id)` arrow created inside that
// function is a fresh closure per row, per render. memo()-wrapped row
// components see a different identity for the handler each time and
// rerender even when the row data didn't change. Hoist the handler at
// list scope (`const handlePress = useCallback((id) => ..., [])`) and
// pass the row's id as a primitive prop.
export const rnListCallbackPerRow: Rule = {
  create: (context: RuleContext) => {
    const inspect = (node: EsTreeNode): void => {
      if (!isRenderItemFunction(node)) return;
      const inlineHandlers = detectInlineRowHandlers(node);
      for (const handler of inlineHandlers) {
        const handlerName =
          handler.name?.type === "JSXIdentifier" ? handler.name.name : "<handler>";
        context.report({
          node: handler,
          message: `Inline ${handlerName} arrow inside renderItem creates a fresh closure per row — hoist with useCallback at list scope and pass the row id as a primitive prop`,
        });
      }
    };

    return {
      ArrowFunctionExpression: inspect,
      FunctionExpression: inspect,
    };
  },
};

const LEGACY_SHADOW_KEYS = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

const findLegacyShadowProperty = (
  objectExpression: EsTreeNode,
): { keyName: string; node: EsTreeNode } | null => {
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    if (property.key?.type !== "Identifier") continue;
    if (LEGACY_SHADOW_KEYS.has(property.key.name)) {
      return { keyName: property.key.name, node: property };
    }
  }
  return null;
};

// HACK: React Native v7+ supports the standard CSS `boxShadow` string
// (`"0 2px 8px rgba(0,0,0,0.1)"`) which renders identically on iOS and
// Android. The legacy `shadowColor`/`shadowOffset`/`shadowOpacity`/
// `shadowRadius` keys only work on iOS, and `elevation` is Android-only,
// so cross-platform code historically had to declare both — `boxShadow`
// collapses that into one key.
export const rnStylePreferBoxShadow: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      const attrName = node.name.name;
      if (attrName !== "style" && !attrName.endsWith("Style")) return;
      if (node.value?.type !== "JSXExpressionContainer") return;
      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;
      const match = findLegacyShadowProperty(expression);
      if (!match) return;
      context.report({
        node: match.node,
        message: `${match.keyName} is iOS/Android-platform-specific — use the cross-platform CSS \`boxShadow\` string (e.g. \`boxShadow: "0 2px 8px rgba(0,0,0,0.1)"\`) on RN v7+`,
      });
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier") return;
      if (node.callee.object.name !== "StyleSheet") return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "create") return;
      const arg = node.arguments?.[0];
      if (arg?.type !== "ObjectExpression") return;
      for (const property of arg.properties ?? []) {
        if (property.type !== "Property") continue;
        if (property.value?.type !== "ObjectExpression") continue;
        const match = findLegacyShadowProperty(property.value);
        if (!match) continue;
        context.report({
          node: match.node,
          message: `${match.keyName} is iOS/Android-platform-specific — use the cross-platform CSS \`boxShadow\` string on RN v7+`,
        });
      }
    },
  }),
};

// HACK: <FlashList recycleItems> (or LegendList) reuses row component
// instances across rows. For HETEROGENEOUS lists (rows of different
// types — section headers, message bubbles, separators), recycling
// without `getItemType` causes wrong-type rows to mount into the
// recycled cells and produces flickers / measurement errors. The fix
// is to provide `getItemType={item => item.kind}` (or similar) so
// FlashList keeps separate recycle pools per type.
//
// Heuristic: <FlashList recycleItems> AND `<FlashList renderItem={...}>`
// where the renderItem return type is varied (multiple JSX element
// names returned via conditional / branching). We approximate by
// flagging any FlashList/LegendList with `recycleItems` and no
// `getItemType` — the user can add `getItemType` if they have one
// item type, in which case the rule is silent.
const RECYCLABLE_LIST_NAMES = new Set(["FlashList", "LegendList"]);

export const rnListRecyclableWithoutTypes: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = resolveJsxElementName(node);
      if (!elementName || !RECYCLABLE_LIST_NAMES.has(elementName)) return;

      let hasRecycleItemsEnabled = false;
      let hasGetItemType = false;

      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier") continue;
        if (attr.name.name === "recycleItems") {
          // Bare `recycleItems` (no `={...}`) → true. `recycleItems={true}`
          // → true. `recycleItems={false}` → DISABLES recycling, so the
          // rule shouldn't fire.
          if (!attr.value) {
            hasRecycleItemsEnabled = true;
          } else if (
            attr.value.type === "JSXExpressionContainer" &&
            attr.value.expression?.type === "Literal"
          ) {
            hasRecycleItemsEnabled = attr.value.expression.value === true;
          } else {
            // Dynamic value: assume it can be true.
            hasRecycleItemsEnabled = true;
          }
        }
        if (attr.name.name === "getItemType") hasGetItemType = true;
      }

      if (hasRecycleItemsEnabled && !hasGetItemType) {
        context.report({
          node,
          message: `<${elementName} recycleItems> without \`getItemType\` — heterogeneous rows mount into the wrong recycled cells. Add \`getItemType={item => item.kind}\` so FlashList keeps separate recycle pools per type`,
        });
      }
    },
  }),
};
