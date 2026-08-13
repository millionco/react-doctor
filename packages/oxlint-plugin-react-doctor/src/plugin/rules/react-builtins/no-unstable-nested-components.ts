import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { shouldUseCuratedPortBehavior } from "../../utils/should-use-curated-port-behavior.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { ControlFlowAnalysis } from "../../semantic/control-flow-graph.js";

const buildMessage = (parentName: string | null): string => {
  let message =
    "Your users lose this component's state on every render because it's defined inside another component";
  if (parentName) message += ` (\`${parentName}\`)`;
  message += ".";
  return message;
};

interface NoUnstableNestedComponentsSettings {
  allowAsProps?: boolean;
  customValidators?: ReadonlyArray<string>;
  propNamePattern?: string;
}

const NESTED_FUNCTION_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
  shouldUseCuratedBehavior: boolean,
): Required<NoUnstableNestedComponentsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noUnstableNestedComponents?: NoUnstableNestedComponentsSettings })
          .noUnstableNestedComponents ?? {})
      : {};
  return {
    // Default `true` because passing a render-prop component
    // (`<Foo Icon={() => <Bar/>}/>`, `<Trans bold={(el) => <b>{el}</b>}/>`,
    // tldraw's `components={{HelperButtons: () => ...}}`, etc.) is the
    // canonical React composition pattern. Users who want strict
    // enforcement opt back in via `allowAsProps: false`.
    allowAsProps: ruleSettings.allowAsProps ?? shouldUseCuratedBehavior,
    customValidators: ruleSettings.customValidators ?? [],
    propNamePattern: ruleSettings.propNamePattern ?? "render*",
  };
};

// Check if a function body / expression contains JSX OR a
// React.createElement call.
const isReactCreateElementCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isReactApiCall(node, "createElement", scopes, {
    allowGlobalReactNamespace: true,
    resolveNamedAliases: true,
  });

const expressionContainsJsxOrCreateElement = (root: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let found = false;
  walkAst(root, (node: EsTreeNode): boolean | void => {
    if (found) return false;
    if (node !== root && NESTED_FUNCTION_TYPES.has(node.type)) return false;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return false;
    }
    if (isNodeOfType(node, "CallExpression") && isReactCreateElementCall(node, scopes)) {
      found = true;
      return false;
    }
  });
  return found;
};

const functionContainsJsxOrCreateElement = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean =>
  expressionContainsJsxOrCreateElement(functionNode, scopes) ||
  functionReturnsMatchingExpression(
    functionNode,
    scopes,
    (expression) => expressionContainsJsxOrCreateElement(expression, scopes),
    controlFlow,
  );

// True iff `classNode` extends React.Component / PureComponent (or a
// bare `Component` / `PureComponent` symbol — matches the import shape
// most React class components actually use).
// Returns true when `classNode` is a *React* class — either by
// explicit `extends React.Component` / `extends Component` lineage, or
// by containing JSX / `React.createElement(...)` in any method body.
// Catches both the canonical class-component shape and the rare hybrid
// case where a class declares JSX in render without `extends`.
const isReactClassComponent = (classNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isEs6Component(classNode)) return true;
  return expressionContainsJsxOrCreateElement(classNode, scopes);
};

// Walk up to find the FIRST enclosing function/class component.
const findEnclosingComponent = (
  node: EsTreeNode,
  functionContainsComponentOutput: (functionNode: EsTreeNode) => boolean,
  classIsReactComponent: (classNode: EsTreeNode) => boolean,
): { component: EsTreeNode; name: string | null } | null => {
  let walker: EsTreeNode | null | undefined = node.parent;
  while (walker) {
    if (isFunctionLike(walker)) {
      const componentName = inferFunctionLikeName(walker);
      if (
        componentName &&
        isReactComponentName(componentName) &&
        functionContainsComponentOutput(walker)
      ) {
        return { component: walker, name: componentName };
      }
      // Anonymous default-exported function returning JSX counts too.
      if (
        !componentName &&
        functionContainsComponentOutput(walker) &&
        walker.parent &&
        isNodeOfType(walker.parent, "ExportDefaultDeclaration")
      ) {
        return { component: walker, name: null };
      }
    }
    if (isNodeOfType(walker, "ClassDeclaration") || isNodeOfType(walker, "ClassExpression")) {
      if (walker.id && isReactComponentName(walker.id.name) && classIsReactComponent(walker)) {
        return { component: walker, name: walker.id.name };
      }
    }
    walker = walker.parent ?? null;
  }
  return null;
};

const inferFunctionLikeName = (functionLike: EsTreeNode): string | null => {
  if (
    (isNodeOfType(functionLike, "FunctionDeclaration") ||
      isNodeOfType(functionLike, "FunctionExpression")) &&
    functionLike.id
  ) {
    return functionLike.id.name;
  }
  const parent = functionLike.parent;
  if (parent && isNodeOfType(parent, "VariableDeclarator")) {
    if (isNodeOfType(parent.id, "Identifier")) return parent.id.name;
  }
  if (parent && isNodeOfType(parent, "Property")) {
    if (isNodeOfType(parent.key, "Identifier")) return parent.key.name;
    if (isNodeOfType(parent.key, "Literal") && typeof parent.key.value === "string") {
      return parent.key.value;
    }
  }
  if (parent && isNodeOfType(parent, "AssignmentExpression")) {
    const left = parent.left as EsTreeNode;
    if (isNodeOfType(left, "Identifier")) return left.name;
    if (isNodeOfType(left, "MemberExpression") && isNodeOfType(left.property, "Identifier")) {
      return left.property.name;
    }
  }
  return null;
};

// Check if `candidateNode` is being passed as the value of a JSX
// attribute (e.g. `<Foo render={() => <Bar/>} />`).
const isComponentDeclaredInProp = (candidateNode: EsTreeNode): { propName: string } | null => {
  let walker: EsTreeNode | null | undefined = candidateNode.parent;
  while (walker) {
    if (isNodeOfType(walker, "Property")) {
      const propName = isNodeOfType(walker.key, "Identifier")
        ? walker.key.name
        : isNodeOfType(walker.key, "Literal") && typeof walker.key.value === "string"
          ? walker.key.value
          : null;
      let propertyWalker: EsTreeNode | null | undefined = walker.parent;
      while (propertyWalker) {
        if (isNodeOfType(propertyWalker, "JSXExpressionContainer")) {
          const attribute = propertyWalker.parent;
          if (attribute && isNodeOfType(attribute, "JSXAttribute")) {
            const attributeName = attribute.name;
            if (isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier")) {
              return { propName: (attributeName as EsTreeNodeOfType<"JSXIdentifier">).name };
            }
          }
          return propName ? { propName } : null;
        }
        if (isNodeOfType(propertyWalker, "CallExpression")) return propName ? { propName } : null;
        propertyWalker = propertyWalker.parent ?? null;
      }
      return propName ? { propName } : null;
    }
    if (isNodeOfType(walker, "JSXExpressionContainer")) {
      const grandparent = walker.parent;
      if (grandparent && isNodeOfType(grandparent, "JSXAttribute")) {
        const attributeName = grandparent.name;
        if (isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier")) {
          return { propName: (attributeName as EsTreeNodeOfType<"JSXIdentifier">).name };
        }
      }
      return null;
    }
    if (isNodeOfType(walker, "CallExpression")) return null;
    walker = walker.parent ?? null;
  }
  return null;
};

const HOC_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "memo",
  "forwardRef",
  "createReactClass",
  "createClass",
  "lazy",
  "observer",
  "Observer",
  "compose",
]);

const isHocCallee = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = call.callee;
  if (isNodeOfType(callee, "Identifier")) return HOC_CALLEE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return HOC_CALLEE_NAMES.has(callee.property.name);
  }
  return false;
};

const isObjectCallbackCandidate = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent || !isNodeOfType(parent, "Property")) return false;
  const keyName = isNodeOfType(parent.key, "Identifier")
    ? parent.key.name
    : isNodeOfType(parent.key, "Literal") && typeof parent.key.value === "string"
      ? parent.key.value
      : null;
  if (keyName && keyName.startsWith("render")) return false;
  let walker = parent.parent;
  while (walker) {
    if (isNodeOfType(walker, "JSXExpressionContainer")) return false;
    if (isNodeOfType(walker, "CallExpression")) return true;
    if (isNodeOfType(walker, "ArrayExpression")) return true;
    walker = walker.parent ?? null;
  }
  return false;
};

const hocCallContainsComponent = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const firstArgument = call.arguments[0] as EsTreeNode | undefined;
  if (!firstArgument) return false;
  if (
    isNodeOfType(firstArgument, "FunctionExpression") ||
    isNodeOfType(firstArgument, "ArrowFunctionExpression") ||
    isNodeOfType(firstArgument, "ClassExpression")
  ) {
    return expressionContainsJsxOrCreateElement(firstArgument, scopes);
  }
  if (isNodeOfType(firstArgument, "CallExpression") && isHocCallee(firstArgument)) {
    return hocCallContainsComponent(firstArgument, scopes);
  }
  return expressionContainsJsxOrCreateElement(firstArgument, scopes);
};

// Returns true when this node is the FIRST argument of an HoC call
// (memo, forwardRef, observer, etc.) — these should NOT be reported,
// the OUTER call expression handles the candidacy.
const isFirstArgumentOfHocCall = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (!isHocCallee(parent)) return false;
  return parent.arguments[0] === node;
};

const MAP_LIKE_METHOD_NAMES: ReadonlySet<string> = new Set([
  "map",
  "forEach",
  "filter",
  "flatMap",
  "reduce",
  "reduceRight",
]);

const isReturnOfMapCallback = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression")) {
    const callee = parent.callee;
    if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
      return MAP_LIKE_METHOD_NAMES.has(callee.property.name);
    }
  }
  if (
    isNodeOfType(parent, "ArrowFunctionExpression") ||
    isNodeOfType(parent, "FunctionExpression")
  ) {
    const callbackParent = parent.parent;
    if (callbackParent && isNodeOfType(callbackParent, "CallExpression")) {
      const callee = callbackParent.callee;
      if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
        return MAP_LIKE_METHOD_NAMES.has(callee.property.name);
      }
    }
  }
  return false;
};

// TS expression wrappers that forward their inner value unchanged.
const TS_VALUE_PASSTHROUGH_TYPES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

// A PascalCase read is instantiation evidence only when it reaches JSX,
// React.createElement, or a recognized element-type prop. Immutable aliases
// are followed to those sinks. Direct calls and React.useMemo callbacks create
// no child fiber, so they are not instantiation evidence.
const ELEMENT_TYPE_PROP_NAMES: ReadonlySet<string> = new Set([
  "as",
  "body",
  "calendarcontainer",
  "component",
  "fallback",
  "tooltip",
]);

const isElementTypeJsxAttribute = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXAttribute")) return false;
  if (!isNodeOfType(node.name, "JSXIdentifier")) return false;
  const attributeName = node.name.name;
  return (
    ELEMENT_TYPE_PROP_NAMES.has(attributeName.toLowerCase()) || attributeName.endsWith("Component")
  );
};

const isReactUseMemoCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  valueNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  call.arguments[0] === valueNode &&
  isReactApiCall(call, "useMemo", scopes, {
    allowGlobalReactNamespace: true,
    resolveNamedAliases: true,
  });

const isReactLazyCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean =>
  isReactApiCall(call, "lazy", scopes, {
    allowGlobalReactNamespace: true,
    resolveNamedAliases: true,
  });

const isRenderFlowingReadReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: ReadonlySet<number> = new Set(),
): boolean => {
  let valueNode: EsTreeNode = identifier;
  let parent: EsTreeNode | null | undefined = valueNode.parent;
  while (parent) {
    if (TS_VALUE_PASSTHROUGH_TYPES.has(parent.type)) {
      valueNode = parent;
      parent = parent.parent;
      continue;
    }
    switch (parent.type) {
      case "JSXOpeningElement":
        return parent.name === valueNode;
      case "JSXExpressionContainer":
        return Boolean(parent.parent && isElementTypeJsxAttribute(parent.parent));
      case "ReturnStatement":
        return false;
      case "ArrowFunctionExpression":
        return false;
      case "CallExpression": {
        if (parent.callee === valueNode) return false;
        if (isReactUseMemoCallback(parent, valueNode, scopes)) return false;
        if (isReactCreateElementCall(parent, scopes)) return true;
        valueNode = parent;
        parent = parent.parent;
        continue;
      }
      case "VariableDeclarator": {
        if (parent.init !== valueNode || !isNodeOfType(parent.id, "Identifier")) {
          return false;
        }
        const aliasSymbol = scopes.symbolFor(parent.id);
        if (!aliasSymbol || aliasSymbol.kind !== "const" || visitedSymbols.has(aliasSymbol.id)) {
          return false;
        }
        const nextVisitedSymbols = new Set(visitedSymbols);
        nextVisitedSymbols.add(aliasSymbol.id);
        return aliasSymbol.references.some(
          (reference) =>
            reference.flag === "read" &&
            isRenderFlowingReadReference(reference.identifier, scopes, nextVisitedSymbols),
        );
      }
      case "AssignmentExpression":
        return false;
      case "Property": {
        if (parent.value !== valueNode) return false;
        valueNode = parent;
        parent = parent.parent;
        continue;
      }
      case "ObjectExpression":
      case "ArrayExpression":
      case "ConditionalExpression":
      case "LogicalExpression":
        valueNode = parent;
        parent = parent.parent;
        continue;
      default:
        return false;
    }
  }
  return false;
};

// Flattens `<Thing.Panel/>` / `createElement(sections.General)` into
// its dotted segments (["Thing", "Panel"]). Returns null for computed
// / private / non-identifier segments.
const collectMemberChainSegments = (memberExpression: EsTreeNode): string[] | null => {
  const segments: string[] = [];
  let current: EsTreeNode = memberExpression;
  while (
    isNodeOfType(current, "JSXMemberExpression") ||
    isNodeOfType(current, "MemberExpression")
  ) {
    if (isNodeOfType(current, "MemberExpression") && current.computed) return null;
    const property = current.property;
    if (!isNodeOfType(property, "Identifier") && !isNodeOfType(property, "JSXIdentifier")) {
      return null;
    }
    segments.unshift(property.name);
    current = current.object;
  }
  if (!isNodeOfType(current, "Identifier") && !isNodeOfType(current, "JSXIdentifier")) return null;
  segments.unshift(current.name);
  return segments;
};

// Port of `oxc_linter::rules::react::no_unstable_nested_components`.
export const noUnstableNestedComponents = defineRule({
  id: "no-unstable-nested-components",
  title: "Component defined inside a component",
  severity: "warn",
  recommendation:
    "Move nested components to module scope so React does not remount them and lose state on every render.",
  category: "Performance",
  tags: ["react-jsx-only"],
  create: (context) => {
    const shouldUseCuratedBehavior = shouldUseCuratedPortBehavior(context.settings);
    const settings = resolveSettings(context.settings, shouldUseCuratedBehavior);
    const renderPropRegex = compileGlob(settings.propNamePattern);

    // Bindings actually INSTANTIATED as React elements (`<Name/>` or
    // `createElement(Name)`). A capitalized nested helper that is only
    // ever invoked as `Name()` is inlined into the parent's render —
    // no child fiber, no state to lose — so requiring instantiation
    // before reporting drops the inline-render-helper false positives.
    // Keyed by the BINDING IDENTIFIER node the usage resolves to, so a
    // same-named JSX usage of a DIFFERENT binding doesn't count; the
    // name set only backs candidates without a binding (object-property
    // components). The binding node (not the symbol id) is the key
    // because scope analysis can register a hoisted declaration under
    // two symbol records that share one binding identifier.
    // Only enforced for candidates that qualify SOLELY by their
    // PascalCase name; prop / object-callback / HoC candidates are
    // instantiated by their consumer and keep firing as before.
    const instantiatedComponentNames = new Set<string>();
    const instantiatedBindingIdentifiers = new Set<EsTreeNode>();
    const componentOutputByFunction = new WeakMap<EsTreeNode, boolean>();
    const reactComponentByClass = new WeakMap<EsTreeNode, boolean>();

    const functionContainsComponentOutput = (functionNode: EsTreeNode): boolean => {
      const cachedResult = componentOutputByFunction.get(functionNode);
      if (cachedResult !== undefined) return cachedResult;
      const result = functionContainsJsxOrCreateElement(functionNode, context.scopes, context.cfg);
      componentOutputByFunction.set(functionNode, result);
      return result;
    };

    const classIsReactComponent = (classNode: EsTreeNode): boolean => {
      const cachedResult = reactComponentByClass.get(classNode);
      if (cachedResult !== undefined) return cachedResult;
      const result = isReactClassComponent(classNode, context.scopes);
      reactComponentByClass.set(classNode, result);
      return result;
    };

    const recordInstantiation = (identifier: EsTreeNode, name: string): void => {
      instantiatedComponentNames.add(name);
      const symbol = context.scopes.symbolFor(identifier);
      if (symbol) instantiatedBindingIdentifiers.add(symbol.bindingIdentifier);
    };

    // `<Thing.Panel/>` instantiates the member-assigned candidate
    // `Thing.Panel = () => …`, whose inferred name is the PROPERTY
    // (`Panel`) and which has no binding — so record the property name
    // (and the full dotted chain) for the name-matching fallback.
    const recordMemberChainInstantiation = (memberExpression: EsTreeNode): void => {
      const segments = collectMemberChainSegments(memberExpression);
      if (!segments || segments.length < 2) return;
      const propertyName = segments.at(-1);
      if (propertyName !== undefined) instantiatedComponentNames.add(propertyName);
      instantiatedComponentNames.add(segments.join("."));
    };

    // The identifier that BINDS the candidate function's name (`function
    // Name()` / `const Name = () => …`). The VariableDeclarator id wins
    // over a named FunctionExpression's own `.id` — for `const X =
    // function Y() {}` outside references resolve to `X`, while `Y` only
    // binds inside the function body. Property keys and member
    // assignments aren't bindings, so those shapes return null and the
    // instantiation gate falls back to name matching.
    const findFunctionBindingIdentifier = (functionLike: EsTreeNode): EsTreeNode | null => {
      const parent = functionLike.parent;
      if (
        parent &&
        isNodeOfType(parent, "VariableDeclarator") &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        return parent.id;
      }
      if (
        (isNodeOfType(functionLike, "FunctionDeclaration") ||
          isNodeOfType(functionLike, "FunctionExpression")) &&
        functionLike.id
      ) {
        return functionLike.id;
      }
      return null;
    };

    interface QueuedReport {
      reportNode: EsTreeNode;
      message: string;
      requiredInstantiationName: string | null;
      requiredInstantiationBinding: EsTreeNode | null;
    }
    const queuedReports: QueuedReport[] = [];

    const enqueueCandidate = (
      candidateNode: EsTreeNode,
      requiredInstantiationName: string | null,
    ): void => {
      if (isFirstArgumentOfHocCall(candidateNode)) return;
      if (isReturnOfMapCallback(candidateNode)) return;
      const propInfo = isComponentDeclaredInProp(candidateNode);
      if (propInfo) {
        if (propInfo.propName === "children") return;
        if (renderPropRegex.test(propInfo.propName)) return;
        if (settings.allowAsProps) return;
      }
      const enclosing = findEnclosingComponent(
        candidateNode,
        functionContainsComponentOutput,
        classIsReactComponent,
      );
      if (!enclosing) return;
      // A prop / object-callback candidate is instantiated by its
      // consumer, so don't gate it on local instantiation.
      const gatedName = propInfo ? null : requiredInstantiationName;
      queuedReports.push({
        reportNode: candidateNode,
        message: buildMessage(enclosing.name),
        requiredInstantiationName: gatedName,
        requiredInstantiationBinding:
          gatedName !== null ? findFunctionBindingIdentifier(candidateNode) : null,
      });
    };

    const checkFunctionLike = (
      node: EsTreeNodeOfType<
        "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression"
      >,
    ): void => {
      const inferredName = inferFunctionLikeName(node as EsTreeNode);
      const propInfo = isComponentDeclaredInProp(node as EsTreeNode);
      const isObjectCallback = isObjectCallbackCandidate(node as EsTreeNode);
      const isNameCandidate = inferredName !== null && isReactComponentName(inferredName);
      const isCandidate = isNameCandidate || propInfo !== null || isObjectCallback;
      if (!isCandidate) return;
      if (!functionContainsComponentOutput(node as EsTreeNode)) return;
      const requiredInstantiationName =
        isNameCandidate && propInfo === null && !isObjectCallback ? inferredName : null;
      enqueueCandidate(node as EsTreeNode, requiredInstantiationName);
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isReactComponentName(node.name.name)) {
          recordInstantiation(node.name as EsTreeNode, node.name.name);
          return;
        }
        if (isNodeOfType(node.name, "JSXMemberExpression")) {
          recordMemberChainInstantiation(node.name as EsTreeNode);
        }
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        if (!isReactComponentName(node.name)) return;
        if (!isRenderFlowingReadReference(node as EsTreeNode, context.scopes)) return;
        recordInstantiation(node as EsTreeNode, node.name);
      },
      FunctionDeclaration: checkFunctionLike,
      FunctionExpression: checkFunctionLike,
      ArrowFunctionExpression: checkFunctionLike,
      ClassDeclaration(node: EsTreeNodeOfType<"ClassDeclaration">) {
        if (!node.id) return;
        if (!isReactComponentName(node.id.name)) return;
        // Only flag classes that are actually React components — the
        // PascalCase-only check otherwise misidentifies any
        // PascalCase-named class (`class NewRoot extends RootState` in
        // tldraw, `class Tool extends BaseTool`, etc.) as a nested React
        // component candidate.
        if (!classIsReactComponent(node as EsTreeNode)) return;
        enqueueCandidate(node as EsTreeNode, null);
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        const inferredName = node.id?.name ?? inferFunctionLikeName(node as EsTreeNode);
        if (!inferredName || !isReactComponentName(inferredName)) return;
        if (!classIsReactComponent(node as EsTreeNode)) return;
        enqueueCandidate(node as EsTreeNode, null);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isReactCreateElementCall(node, context.scopes)) {
          const firstArgument = node.arguments[0] as EsTreeNode | undefined;
          if (firstArgument && isNodeOfType(firstArgument, "Identifier")) {
            recordInstantiation(firstArgument, firstArgument.name);
          } else if (firstArgument && isNodeOfType(firstArgument, "MemberExpression")) {
            recordMemberChainInstantiation(firstArgument);
          }
        }
        const isReactLazy = isReactLazyCall(node, context.scopes);
        if (!isReactLazy && !isHocCallee(node)) return;
        if (!isReactLazy && !hocCallContainsComponent(node, context.scopes)) {
          return;
        }
        const inferredName = inferFunctionLikeName(node as EsTreeNode);
        const propInfo = isComponentDeclaredInProp(node as EsTreeNode);
        if (propInfo === null && (!inferredName || !isReactComponentName(inferredName))) return;
        enqueueCandidate(node as EsTreeNode, propInfo === null ? inferredName : null);
      },
      "Program:exit"() {
        for (const report of queuedReports) {
          if (report.requiredInstantiationName !== null) {
            const requiredSymbol = report.requiredInstantiationBinding
              ? context.scopes.symbolFor(report.requiredInstantiationBinding)
              : null;
            if (
              requiredSymbol?.references.some(
                (reference) => reference.flag === "write" || reference.flag === "read-write",
              )
            ) {
              continue;
            }
            const isInstantiated =
              report.requiredInstantiationBinding !== null
                ? instantiatedBindingIdentifiers.has(report.requiredInstantiationBinding)
                : instantiatedComponentNames.has(report.requiredInstantiationName);
            if (!isInstantiated) continue;
          }
          context.report({ node: report.reportNode, message: report.message });
        }
      },
    };
  },
});
