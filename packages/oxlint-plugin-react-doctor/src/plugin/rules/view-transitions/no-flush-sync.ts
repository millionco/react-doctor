import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// Libraries that position or attach to freshly committed DOM — the
// canonical justified `flushSync` integration (the DOM must be committed
// before the library's next line measures it).
const IMPERATIVE_DOM_LIBRARY_SOURCE_PATTERN =
  /^(?:@floating-ui\/|@popperjs\/|react-popper$|popper\.js$|shaka-player)/;

// DOM reads that only make sense against a committed tree. `flushSync`
// followed by (or wrapped around) one of these is the documented
// exemption: a third-party/imperative consumer measuring fresh layout.
const DOM_MEASUREMENT_NAMES: ReadonlySet<string> = new Set([
  "getBoundingClientRect",
  "getClientRects",
  "getComputedStyle",
  "getAnimations",
  "scrollIntoView",
  "elementFromPoint",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "scrollTop",
  "scrollLeft",
  "scrollWidth",
  "scrollHeight",
]);

const MEASUREMENT_HELPER_CALLEE_PATTERN =
  /^(?:get|measure|read)\w*(?:Width|Height|Rect|Rects|Size|Bounds|Position)$/;

const IMPERATIVE_DOM_MUTATION_NAMES: ReadonlySet<string> = new Set([
  "blur",
  "focus",
  "restoreSelection",
  "scroll",
  "scrollBy",
  "scrollIntoView",
  "scrollTo",
  "setRangeText",
  "setSelectionRange",
]);

const subtreeReadsDomMeasurement = (root: EsTreeNode | null | undefined): boolean => {
  if (!root) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "MemberExpression") && isNodeOfType(child.property, "Identifier")) {
      if (DOM_MEASUREMENT_NAMES.has(child.property.name)) {
        found = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      MEASUREMENT_HELPER_CALLEE_PATTERN.test(child.callee.name)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const collectFunctionNamesMatchingBody = (
  program: EsTreeNode,
  matchesBody: (body: EsTreeNode | null | undefined) => boolean,
): Set<string> => {
  const names = new Set<string>();
  walkAst(program, (child: EsTreeNode) => {
    if (isNodeOfType(child, "FunctionDeclaration")) {
      if (child.id && isNodeOfType(child.id, "Identifier") && matchesBody(child.body)) {
        names.add(child.id.name);
      }
      return;
    }
    if (!isNodeOfType(child, "VariableDeclarator") || !isNodeOfType(child.id, "Identifier")) return;
    let functionValue: EsTreeNode | null | undefined = child.init;
    if (
      functionValue &&
      isNodeOfType(functionValue, "CallExpression") &&
      isNodeOfType(functionValue.callee, "Identifier") &&
      /^use[A-Z]/.test(functionValue.callee.name)
    ) {
      functionValue = functionValue.arguments?.[0];
    }
    if (functionValue && isFunctionLike(functionValue) && matchesBody(functionValue.body)) {
      names.add(child.id.name);
    }
  });
  return names;
};

const collectMeasuringFunctionNames = (program: EsTreeNode): Set<string> =>
  collectFunctionNamesMatchingBody(program, subtreeReadsDomMeasurement);

const subtreeMutatesDomImperatively = (root: EsTreeNode | null | undefined): boolean => {
  if (!root || isFunctionLike(root)) return false;
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (child !== root && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    const propertyName = isNodeOfType(callee, "MemberExpression")
      ? getStaticPropertyName(callee)
      : null;
    if (propertyName !== null && IMPERATIVE_DOM_MUTATION_NAMES.has(propertyName)) {
      found = true;
      return false;
    }
  });
  return found;
};

const collectImperativeDomFunctionNames = (program: EsTreeNode): Set<string> =>
  collectFunctionNamesMatchingBody(program, subtreeMutatesDomImperatively);

const callsAnyName = (
  root: EsTreeNode | null | undefined,
  names: ReadonlySet<string>,
  shouldSkipNestedFunctions = false,
): boolean => {
  if (!root || names.size === 0 || (shouldSkipNestedFunctions && isFunctionLike(root))) {
    return false;
  }
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (shouldSkipNestedFunctions && child !== root && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      names.has(child.callee.name)
    ) {
      found = true;
    }
  });
  return found;
};

const isFollowedByImperativeDomMutation = (
  call: EsTreeNode,
  imperativeDomFunctionNames: ReadonlySet<string>,
): boolean => {
  let statement: EsTreeNode = call;
  let parent = statement.parent;
  while (parent) {
    const statements =
      isNodeOfType(parent, "BlockStatement") ||
      isNodeOfType(parent, "Program") ||
      isNodeOfType(parent, "StaticBlock")
        ? parent.body
        : isNodeOfType(parent, "SwitchCase")
          ? parent.consequent
          : null;
    if (statements) {
      const statementIndex = statements.findIndex(
        (siblingStatement) => siblingStatement === statement,
      );
      if (statementIndex >= 0) {
        const nextStatement = statements[statementIndex + 1];
        return (
          subtreeMutatesDomImperatively(nextStatement) ||
          callsAnyName(nextStatement, imperativeDomFunctionNames, true)
        );
      }
    }
    if (
      isFunctionLike(parent) ||
      (parent.type.endsWith("Statement") && !isNodeOfType(parent, "ExpressionStatement"))
    ) {
      return false;
    }
    statement = parent;
    parent = parent.parent;
  }
  return false;
};

const isInsideStartViewTransition = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee = cursor.callee;
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
          ? callee.property.name
          : null;
      if (calleeName === "startViewTransition") return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const enclosingFunctionChainReadsMeasurement = (
  node: EsTreeNode,
  measuringFunctionNames: ReadonlySet<string>,
): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      const body = (cursor as { body?: EsTreeNode | null }).body;
      if (subtreeReadsDomMeasurement(body) || callsAnyName(body, measuringFunctionNames)) {
        return true;
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const findProgram = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "Program")) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const importsImperativeDomLibrary = (program: EsTreeNode): boolean => {
  for (const stmt of (program as { body?: EsTreeNode[] }).body ?? []) {
    if (!isNodeOfType(stmt, "ImportDeclaration")) continue;
    const source = stmt.source?.value;
    if (typeof source === "string" && IMPERATIVE_DOM_LIBRARY_SOURCE_PATTERN.test(source)) {
      return true;
    }
  }
  return false;
};

// A justified call keeps the import regardless of the file's other call
// sites, so one exempt usage silences the (per-file, import-anchored)
// diagnostic.
const hasExemptFlushSyncCall = (program: EsTreeNode, localName: string): boolean => {
  const measuringFunctionNames = collectMeasuringFunctionNames(program);
  const imperativeDomFunctionNames = collectImperativeDomFunctionNames(program);
  let exempt = false;
  walkAst(program, (child: EsTreeNode) => {
    if (exempt) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isNodeOfType(child.callee, "Identifier") ||
      child.callee.name !== localName
    ) {
      return;
    }
    if (
      isInsideStartViewTransition(child) ||
      enclosingFunctionChainReadsMeasurement(child, measuringFunctionNames) ||
      isFollowedByImperativeDomMutation(child, imperativeDomFunctionNames)
    ) {
      exempt = true;
      return false;
    }
  });
  return exempt;
};

// HACK: `flushSync` from react-dom forces a synchronous flush, which
// skips the View Transition snapshot phase entirely — any animation that
// would have triggered is silently dropped. We report only on the import
// (a single actionable diagnostic per file) instead of on every call
// site, which would clutter output for files with several flushSync()s.
//
// Documented exemption (see the rule's fix prompt): integrating with a
// non-React imperative library that must observe fully-committed DOM.
// Detected as (a) an import from a positioning/media library, (b) a
// flushSync wrapped in `startViewTransition` (the sanctioned pairing), or
// (c) a flushSync whose enclosing function measures the DOM.
export const noFlushSync = defineRule({
  id: "no-flush-sync",
  title: "flushSync skips View Transitions",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "flushSync forces an immediate update that skips View Transitions and concurrent rendering. Use startTransition for updates that are not urgent.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-dom") return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (getImportedName(specifier) !== "flushSync") continue;

        const program = findProgram(node as EsTreeNode);
        if (program) {
          if (importsImperativeDomLibrary(program)) return;
          const localName = isNodeOfType(specifier.local, "Identifier")
            ? specifier.local.name
            : "flushSync";
          if (hasExemptFlushSyncCall(program, localName)) return;
        }

        context.report({
          node: specifier,
          message:
            "`flushSync` forces an immediate update, which skips View Transitions and concurrent rendering.",
        });
      }
    },
  }),
});
