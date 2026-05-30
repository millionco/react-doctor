import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "Component is missing a `displayName` — assign one for easier debugging.";

interface DisplayNameSettings {
  ignoreTranspilerName?: boolean;
  checkContextObjects?: boolean;
  reactVersion?: string;
  // Additional callee names that should be treated as
  // display-name-affecting HoCs alongside the built-in `memo` /
  // `forwardRef`. Matches the ESLint `react/display-name` setting
  // `componentWrapperFunctions`. Defaults to project-common HoCs
  // (`observer`, `withTracking`, `lazy`) so the rule lights up on
  // MobX and analytics wrappers out of the box.
  additionalHoCs?: ReadonlyArray<string>;
}

const DEFAULT_ADDITIONAL_HOCS: ReadonlyArray<string> = ["observer", "lazy", "withTracking"];

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): {
  ignoreTranspilerName: boolean;
  checkContextObjects: boolean;
  reactVersion: string;
  additionalHoCs: ReadonlySet<string>;
} => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { displayName?: DisplayNameSettings }).displayName ?? {})
      : {};
  const additionalHoCs = new Set<string>(ruleSettings.additionalHoCs ?? DEFAULT_ADDITIONAL_HOCS);
  return {
    ignoreTranspilerName: ruleSettings.ignoreTranspilerName ?? false,
    checkContextObjects: ruleSettings.checkContextObjects ?? false,
    reactVersion: ruleSettings.reactVersion ?? "",
    additionalHoCs,
  };
};

const isReactVersionAtLeast = (version: string, major: number, minor: number): boolean => {
  if (!version) return true;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return true;
  const actualMajor = Number(match[1]);
  const actualMinor = Number(match[2]);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
};

const containsJsx = (root: EsTreeNode): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return;
    }
    if (isNodeOfType(node, "CallExpression") && isCreateElementCall(node)) {
      found = true;
      return;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (found) return;
    }
  };
  visit(root);
  return found;
};

const getStaticMemberName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression")) return null;
  if (!node.computed && isNodeOfType(node.property, "Identifier")) return node.property.name;
  if (
    node.computed &&
    isNodeOfType(node.property, "Literal") &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return null;
};

const getAssignedName = (node: EsTreeNode): string | null => {
  let parent = node.parent;
  while (
    parent &&
    (parent.type === "TSAsExpression" ||
      parent.type === "TSSatisfiesExpression" ||
      parent.type === "TSNonNullExpression" ||
      parent.type === "TSTypeAssertion")
  ) {
    parent = parent.parent ?? null;
  }
  if (!parent) return null;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (isNodeOfType(parent, "AssignmentExpression")) {
    const left = parent.left as EsTreeNode;
    if (isNodeOfType(left, "Identifier")) return left.name;
    if (isNodeOfType(left, "MemberExpression")) return getStaticMemberName(left);
  }
  return null;
};

const isModuleExportsAssignment = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent || !isNodeOfType(parent, "AssignmentExpression")) return false;
  const left = parent.left as EsTreeNode;
  return (
    isNodeOfType(left, "MemberExpression") &&
    isNodeOfType(left.object, "Identifier") &&
    left.object.name === "module" &&
    getStaticMemberName(left) === "exports"
  );
};

const isCreateClassLikeCall = (node: EsTreeNode): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isEs5Component(node)) return true;
  const callee = node.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    return getStaticMemberName(callee) === "createClass";
  }
  return false;
};

const isCreateContextCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name === "createContext";
  return (
    isNodeOfType(callee, "MemberExpression") && getStaticMemberName(callee) === "createContext"
  );
};

const getCallName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression")) return getStaticMemberName(callee);
  return null;
};

const isNamedFunctionLike = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "FunctionDeclaration")) &&
  Boolean(node.id?.name);

const firstCallArgument = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const first = node.arguments[0];
  return first ? (first as EsTreeNode) : null;
};

// Returns the bare HoC name when `node` is a recognised
// display-name-affecting HoC call. Handles:
//
//   memo(Comp)               → "memo"
//   forwardRef(Comp)         → "forwardRef"
//   React.memo(Comp)         → "memo"
//   React.forwardRef(Comp)   → "forwardRef"
//   observer(Comp)           → "observer"        (when in additionalHoCs)
//   lazy(() => import(...))  → "lazy"            (when in additionalHoCs)
//   anyName(Comp)            → "anyName"         (when in additionalHoCs)
//
// Returns null when the callee isn't a known HoC, so callers can
// distinguish "no HoC at all" from "HoC of kind X".
const resolveHoCCalleeName = (
  node: EsTreeNode,
  additionalHoCs: ReadonlySet<string>,
): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (callee.name === "memo" || callee.name === "forwardRef") return callee.name;
    if (additionalHoCs.has(callee.name)) return callee.name;
    return null;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    const propertyName = callee.property.name;
    if (propertyName === "memo" || propertyName === "forwardRef") return propertyName;
    if (additionalHoCs.has(propertyName)) return propertyName;
  }
  return null;
};

const isDisplayNameHoC = (node: EsTreeNode, additionalHoCs: ReadonlySet<string>): boolean =>
  resolveHoCCalleeName(node, additionalHoCs) !== null;

const supportsComposedForwardRefDisplayName = (version: string): boolean => {
  if (!version) return false;
  if (isReactVersionAtLeast(version, 15, 7)) return true;
  const match = version.match(/^0\.14\.(\d+)/);
  return Boolean(match && Number(match[1]) >= 11);
};

const shouldReportHoCDisplayName = (
  node: EsTreeNode,
  settings: {
    reactVersion: string;
    additionalHoCs: ReadonlySet<string>;
  },
): boolean => {
  if (!isDisplayNameHoC(node, settings.additionalHoCs)) return false;
  if (!containsJsx(node)) return false;

  const assignedName = getAssignedName(node);
  const programRoot = findProgramRoot(node);
  if (assignedName && programRoot && hasDisplayNameAssignment(assignedName, programRoot)) {
    return false;
  }

  const callName = resolveHoCCalleeName(node, settings.additionalHoCs);
  const firstArgument = firstCallArgument(node);
  if (!firstArgument) return false;

  if (
    callName === "forwardRef" &&
    isNodeOfType(node.parent, "CallExpression") &&
    resolveHoCCalleeName(node.parent, settings.additionalHoCs) === "memo" &&
    firstCallArgument(node.parent) === node &&
    supportsComposedForwardRefDisplayName(settings.reactVersion)
  ) {
    return false;
  }

  if (callName === "memo" && isNodeOfType(firstArgument, "CallExpression")) {
    if (resolveHoCCalleeName(firstArgument, settings.additionalHoCs) !== "forwardRef") return false;
    return !supportsComposedForwardRefDisplayName(settings.reactVersion);
  }

  if (isNamedFunctionLike(firstArgument)) return false;
  return (
    isNodeOfType(firstArgument, "FunctionExpression") ||
    isNodeOfType(firstArgument, "ArrowFunctionExpression")
  );
};

const hasDisplayNameMember = (classNode: EsTreeNode): boolean => {
  const classBody = (classNode as { body?: EsTreeNode }).body;
  if (!classBody) return false;
  const members = (classBody as { body?: ReadonlyArray<EsTreeNode> }).body ?? [];
  for (const member of members) {
    if (
      (isNodeOfType(member, "PropertyDefinition") || isNodeOfType(member, "MethodDefinition")) &&
      "static" in member &&
      member.static &&
      isNodeOfType(member.key, "Identifier") &&
      member.key.name === "displayName"
    ) {
      return true;
    }
  }
  return false;
};

// Looks for a `<ClassName>.displayName = ...` assignment ANYWHERE in
// the program. Transpiler output and most React codebases attach
// display names this way for non-anonymous classes/functions.
const hasDisplayNameAssignment = (className: string, programRoot: EsTreeNode): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.left.object, "Identifier") &&
      node.left.object.name === className &&
      getStaticMemberName(node.left) === "displayName"
    ) {
      found = true;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (found) return;
    }
  };
  visit(programRoot);
  return found;
};

const memberExpressionPath = (node: EsTreeNode): ReadonlyArray<string> => {
  if (isNodeOfType(node, "Identifier")) return [node.name];
  if (!isNodeOfType(node, "MemberExpression")) return [];
  const objectPath = memberExpressionPath(node.object);
  const propertyName = getStaticMemberName(node);
  return propertyName ? [...objectPath, propertyName] : objectPath;
};

const hasDisplayNameAssignmentForProperty = (
  propertyName: string,
  programRoot: EsTreeNode,
): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      isNodeOfType(node.left, "MemberExpression") &&
      getStaticMemberName(node.left) === "displayName"
    ) {
      const objectPath = memberExpressionPath(node.left.object);
      if (objectPath.includes(propertyName)) {
        found = true;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (found) return;
    }
  };
  visit(programRoot);
  return found;
};

// Port of `oxc_linter::rules::react::display_name`. Reports React
// components whose displayName is unknown to React DevTools — most
// often anonymous function expressions assigned to `module.exports` /
// returned from HoCs, or class components without a static
// `displayName` property where the class name itself is anonymous.
//
// HoC awareness covers:
//
//   memo(...)              forwardRef(...)
//   React.memo(...)        React.forwardRef(...)
//   memo(forwardRef(...))  forwardRef inside memo (React-version aware)
//
// Plus user-configurable additional HoCs via the
// `react-doctor.displayName.additionalHoCs` setting. Default extras:
// MobX `observer`, React `lazy`, and the project-common
// `withTracking` analytics wrapper. Add any custom HoC the project
// uses to extend the default list.
//
// Also recognises createReactClass / React.createClass / similar
// legacy factories that take a config object — those need a
// `displayName` property in the config when the assigned binding
// isn't PascalCase.
export const displayName = defineRule<Rule>({
  id: "display-name",
  severity: "warn",
  // Minor debug-helper rule — modern bundlers preserve function names
  // so React DevTools shows meaningful names without explicit
  // `displayName` in most cases. Off-by-default in upstream
  // `eslint-plugin-react`'s recommended config since v8.x. Default off.
  defaultEnabled: false,
  recommendation: "Assign each component a stable `displayName` for clearer dev-tooling output.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const ignoreNamed = settings.ignoreTranspilerName ? false : true;

    const reportAt = (node: EsTreeNode): void => {
      context.report({ node, message: MESSAGE });
    };

    return {
      ClassDeclaration(node: EsTreeNodeOfType<"ClassDeclaration">) {
        if (!isEs6Component(node)) return;
        if (node.id && isReactComponentName(node.id.name) && ignoreNamed) return;
        if (hasDisplayNameMember(node as EsTreeNode)) return;
        if (node.id) {
          const programRoot = findProgramRoot(node);
          if (programRoot && hasDisplayNameAssignment(node.id.name, programRoot)) return;
        }
        reportAt(node.id ?? node);
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        if (!isEs6Component(node)) return;
        if (node.id && isReactComponentName(node.id.name) && ignoreNamed) return;
        if (hasDisplayNameMember(node as EsTreeNode)) return;
        if (node.id) {
          const programRoot = findProgramRoot(node);
          if (programRoot && hasDisplayNameAssignment(node.id.name, programRoot)) return;
        }
        reportAt(node.id ?? node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (!containsJsx(node)) return;
        if (node.id && isReactComponentName(node.id.name) && ignoreNamed) return;
        if (isNodeOfType(node.parent, "Property") && node.parent.method) {
          const key = node.parent.key as EsTreeNode;
          const propertyName = isNodeOfType(key, "Identifier")
            ? key.name
            : isNodeOfType(key, "Literal") && typeof key.value === "string"
              ? key.value
              : null;
          const programRoot = findProgramRoot(node);
          if (
            propertyName &&
            isReactComponentName(propertyName) &&
            settings.ignoreTranspilerName &&
            (!programRoot || !hasDisplayNameAssignmentForProperty(propertyName, programRoot))
          ) {
            reportAt(node as EsTreeNode);
            return;
          }
        }
        const assignedName = getAssignedName(node);
        if (assignedName && isReactComponentName(assignedName) && ignoreNamed) return;
        if (isModuleExportsAssignment(node as EsTreeNode) && !node.id) {
          reportAt(node as EsTreeNode);
          return;
        }
        if (isNodeOfType(node.parent, "ReturnStatement") && !node.id) {
          reportAt(node as EsTreeNode);
        }
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (!containsJsx(node)) return;
        if (isNodeOfType(node.parent, "ArrowFunctionExpression")) {
          reportAt(node as EsTreeNode);
          return;
        }
        let parent: EsTreeNode | null | undefined = node.parent;
        // Anonymous arrow assigned to a PascalCase var binding or
        // declared as a default export → name is inferable; skip.
        while (parent) {
          if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
            if (isReactComponentName(parent.id.name) && ignoreNamed) return;
            break;
          }
          if (isNodeOfType(parent, "ExportDefaultDeclaration")) {
            reportAt(node as EsTreeNode);
            return;
          }
          if (isModuleExportsAssignment(node as EsTreeNode)) {
            reportAt(node as EsTreeNode);
            return;
          }
          if (
            isNodeOfType(parent, "FunctionDeclaration") ||
            isNodeOfType(parent, "FunctionExpression") ||
            isNodeOfType(parent, "ArrowFunctionExpression") ||
            isNodeOfType(parent, "ClassDeclaration") ||
            isNodeOfType(parent, "ClassExpression") ||
            isNodeOfType(parent, "Program")
          ) {
            break;
          }
          parent = parent.parent ?? null;
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          settings.checkContextObjects &&
          isReactVersionAtLeast(settings.reactVersion, 16, 3) &&
          isCreateContextCall(node as EsTreeNode)
        ) {
          const assignedName = getAssignedName(node as EsTreeNode);
          if (assignedName) {
            const programRoot = findProgramRoot(node as EsTreeNode);
            if (programRoot && hasDisplayNameAssignment(assignedName, programRoot)) return;
          }
          reportAt(node as EsTreeNode);
          return;
        }
        if (shouldReportHoCDisplayName(node as EsTreeNode, settings)) {
          reportAt(node as EsTreeNode);
          return;
        }
        // Detect createReactClass / React.createClass / similar
        // legacy-component factories without an explicit
        // `displayName` property in their config object.
        if (!isCreateClassLikeCall(node as EsTreeNode)) return;
        const propsArgument = node.arguments[0];
        if (!propsArgument || !isNodeOfType(propsArgument as EsTreeNode, "ObjectExpression")) {
          // No config object — can't have displayName.
          reportAt(node as EsTreeNode);
          return;
        }
        let hasDisplayName = false;
        for (const property of (propsArgument as EsTreeNodeOfType<"ObjectExpression">).properties) {
          if (!isNodeOfType(property as EsTreeNode, "Property")) continue;
          if ((property as EsTreeNodeOfType<"Property">).computed) continue;
          const key = (property as EsTreeNodeOfType<"Property">).key as EsTreeNode;
          if (isNodeOfType(key, "Identifier") && key.name === "displayName") {
            hasDisplayName = true;
            break;
          }
          if (isNodeOfType(key, "Literal") && key.value === "displayName") {
            hasDisplayName = true;
            break;
          }
        }
        if (hasDisplayName) return;
        // Bound to a PascalCase variable? Inferable name.
        const parent = (node as EsTreeNode).parent;
        if (
          parent &&
          isNodeOfType(parent, "VariableDeclarator") &&
          isNodeOfType(parent.id, "Identifier") &&
          isReactComponentName(parent.id.name) &&
          ignoreNamed
        ) {
          return;
        }
        if (parent && isNodeOfType(parent, "AssignmentExpression")) {
          const left = parent.left as EsTreeNode;
          if (isNodeOfType(left, "Identifier") && isReactComponentName(left.name) && ignoreNamed) {
            return;
          }
          if (
            isNodeOfType(left, "MemberExpression") &&
            isNodeOfType(left.property, "Identifier") &&
            isReactComponentName(left.property.name) &&
            ignoreNamed
          ) {
            return;
          }
        }
        // Suppress unused warning.
        void isCreateElementCall;
        reportAt(node as EsTreeNode);
      },
    };
  },
});
