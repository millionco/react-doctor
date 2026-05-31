import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { Rule } from "../../utils/rule.js";

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
    allowAsProps: ruleSettings.allowAsProps ?? true,
    customValidators: ruleSettings.customValidators ?? [],
    propNamePattern: ruleSettings.propNamePattern ?? "render*",
  };
};

// Check if a function body / expression contains JSX OR a
// React.createElement call.
const expressionContainsJsxOrCreateElement = (root: EsTreeNode): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return;
    }
    if (isNodeOfType(node, "CallExpression") && isCreateElementCall(node as EsTreeNode)) {
      found = true;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (!isAstNode(item)) continue;
          // Don't cross into a nested function body — its JSX belongs
          // to the inner component candidate, not this one.
          if (NESTED_FUNCTION_TYPES.has(item.type)) continue;
          visit(item);
          if (found) return;
        }
      } else if (isAstNode(child)) {
        if (NESTED_FUNCTION_TYPES.has(child.type)) continue;
        visit(child);
      }
      if (found) return;
    }
  };
  visit(root);
  return found;
};

// True iff `classNode` extends React.Component / PureComponent (or a
// bare `Component` / `PureComponent` symbol — matches the import shape
// most React class components actually use).
const classExtendsReactComponent = (classNode: EsTreeNode): boolean => {
  const superClass = (classNode as { superClass?: EsTreeNode | null }).superClass;
  if (!superClass) return false;
  if (
    isNodeOfType(superClass, "Identifier") &&
    (superClass.name === "Component" || superClass.name === "PureComponent")
  ) {
    return true;
  }
  if (
    isNodeOfType(superClass, "MemberExpression") &&
    isNodeOfType(superClass.object, "Identifier") &&
    superClass.object.name === "React" &&
    isNodeOfType(superClass.property, "Identifier") &&
    (superClass.property.name === "Component" || superClass.property.name === "PureComponent")
  ) {
    return true;
  }
  return false;
};

// Returns true when `classNode` is a *React* class — either by
// explicit `extends React.Component` / `extends Component` lineage, or
// by containing JSX / `React.createElement(...)` in any method body.
// Catches both the canonical class-component shape and the rare hybrid
// case where a class declares JSX in render without `extends`.
const isReactClassComponent = (classNode: EsTreeNode): boolean => {
  if (classExtendsReactComponent(classNode)) return true;
  return expressionContainsJsxOrCreateElement(classNode);
};

// Walk up to find the FIRST enclosing function/class component.
const findEnclosingComponent = (
  node: EsTreeNode,
): { component: EsTreeNode; name: string | null } | null => {
  let walker: EsTreeNode | null | undefined = node.parent;
  while (walker) {
    if (isFunctionLike(walker)) {
      const componentName = inferFunctionLikeName(walker);
      if (
        componentName &&
        isReactComponentName(componentName) &&
        expressionContainsJsxOrCreateElement(walker)
      ) {
        return { component: walker, name: componentName };
      }
      // Anonymous default-exported function returning JSX counts too.
      if (
        !componentName &&
        expressionContainsJsxOrCreateElement(walker) &&
        walker.parent &&
        isNodeOfType(walker.parent, "ExportDefaultDeclaration")
      ) {
        return { component: walker, name: null };
      }
    }
    if (isNodeOfType(walker, "ClassDeclaration") || isNodeOfType(walker, "ClassExpression")) {
      if (walker.id && isReactComponentName(walker.id.name) && isReactClassComponent(walker)) {
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

const hocCallContainsComponent = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = call.arguments[0] as EsTreeNode | undefined;
  if (!firstArgument) return false;
  if (
    isNodeOfType(firstArgument, "FunctionExpression") ||
    isNodeOfType(firstArgument, "ArrowFunctionExpression") ||
    isNodeOfType(firstArgument, "ClassExpression")
  ) {
    return expressionContainsJsxOrCreateElement(firstArgument);
  }
  if (isNodeOfType(firstArgument, "CallExpression") && isHocCallee(firstArgument)) {
    return hocCallContainsComponent(firstArgument);
  }
  return expressionContainsJsxOrCreateElement(firstArgument);
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

const isReturnOfMapCallback = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression")) {
    const callee = parent.callee;
    if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
      return ["map", "forEach", "filter", "flatMap", "reduce", "reduceRight"].includes(
        callee.property.name,
      );
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
        return ["map", "forEach", "filter", "flatMap", "reduce", "reduceRight"].includes(
          callee.property.name,
        );
      }
    }
  }
  return false;
};

// Port of `oxc_linter::rules::react::no_unstable_nested_components`.
export const noUnstableNestedComponents = defineRule<Rule>({
  id: "no-unstable-nested-components",
  title: "Component defined inside a component",
  severity: "warn",
  recommendation: "Move nested components to the top of the file. Never define one inside another.",
  category: "Performance",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const renderPropRegex = compileGlob(settings.propNamePattern);

    const reportCandidate = (
      candidateNode: EsTreeNode,
      reportNode: EsTreeNode,
      candidateName: string | null,
    ): void => {
      if (isFirstArgumentOfHocCall(candidateNode)) return;
      if (isReturnOfMapCallback(candidateNode)) return;
      const propInfo = isComponentDeclaredInProp(candidateNode);
      if (propInfo) {
        if (propInfo.propName === "children") return;
        if (renderPropRegex.test(propInfo.propName)) return;
        if (settings.allowAsProps) return;
      }
      const enclosing = findEnclosingComponent(candidateNode);
      if (!enclosing) return;
      // Skip if outer doesn't actually look like a component (require
      // its body to contain JSX).
      context.report({
        node: reportNode,
        message: buildMessage(enclosing.name),
      });
      void candidateName;
    };

    const checkFunctionLike = (
      node: EsTreeNodeOfType<
        "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression"
      >,
    ): void => {
      if (!expressionContainsJsxOrCreateElement(node as EsTreeNode)) {
        return;
      }
      const inferredName = inferFunctionLikeName(node as EsTreeNode);
      const propInfo = isComponentDeclaredInProp(node as EsTreeNode);
      const isCandidate =
        (inferredName !== null && isReactComponentName(inferredName)) ||
        propInfo !== null ||
        isObjectCallbackCandidate(node as EsTreeNode);
      if (!isCandidate) return;
      reportCandidate(node as EsTreeNode, node as EsTreeNode, inferredName);
    };

    return {
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
        if (!isReactClassComponent(node as EsTreeNode)) return;
        reportCandidate(node as EsTreeNode, node as EsTreeNode, node.id.name);
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        const inferredName = node.id?.name ?? inferFunctionLikeName(node as EsTreeNode);
        if (!inferredName || !isReactComponentName(inferredName)) return;
        if (!isReactClassComponent(node as EsTreeNode)) return;
        reportCandidate(node as EsTreeNode, node as EsTreeNode, inferredName);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHocCallee(node)) return;
        if (!hocCallContainsComponent(node)) return;
        reportCandidate(node as EsTreeNode, node as EsTreeNode, null);
      },
    };
  },
});
