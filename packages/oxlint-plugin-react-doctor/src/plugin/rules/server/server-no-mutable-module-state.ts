import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
]);

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

const OBJECT_MUTATING_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

const isMutableConstInitializer = (
  init: EsTreeNode | null | undefined
): string | null => {
  if (!init) return null;
  if (isNodeOfType(init, "ArrayExpression")) return "[]";
  if (isNodeOfType(init, "ObjectExpression")) return "{}";
  if (
    isNodeOfType(init, "NewExpression") &&
    isNodeOfType(init.callee, "Identifier") &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(init.callee.name)
  ) {
    return `new ${init.callee.name}()`;
  }
  return null;
};

const targetsBinding = (
  object: EsTreeNode | null | undefined,
  name: string
): boolean =>
  Boolean(object && isNodeOfType(object, "Identifier") && object.name === name);

// True when `name`'s contents are written anywhere in the module: a member
// assignment (`X.y = …`, `X[i] = …`), `delete X.y`, a mutating method call
// (`X.push(...)`, `X.set(...)`), or `Object.assign(X, …)`. A const container
// that is never mutated is an immutable lookup table — sharing it across
// requests is correct, so it must NOT be flagged.
const isContainerMutated = (programNode: EsTreeNode, name: string): boolean => {
  let didMutate = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didMutate) return;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      targetsBinding(child.left.object, name)
    ) {
      didMutate = true;
      return;
    }
    if (
      isNodeOfType(child, "UpdateExpression") &&
      isNodeOfType(child.argument, "MemberExpression") &&
      targetsBinding(child.argument.object, name)
    ) {
      didMutate = true;
      return;
    }
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "delete" &&
      isNodeOfType(child.argument, "MemberExpression") &&
      targetsBinding(child.argument.object, name)
    ) {
      didMutate = true;
      return;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression")
    ) {
      const callee = child.callee;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (
        targetsBinding(callee.object, name) &&
        MUTATING_METHODS.has(callee.property.name)
      ) {
        didMutate = true;
        return;
      }
      // `Object.assign(X, …)` / `Object.defineProperty(X, …)`.
      if (
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "Object" &&
        OBJECT_MUTATING_METHODS.has(callee.property.name) &&
        targetsBinding(child.arguments?.[0], name)
      ) {
        didMutate = true;
      }
    }
  });
  return didMutate;
};

// HACK: in `"use server"` files, mutable module-level state (let/var, OR
// const-bound mutable containers like Map/Set/WeakMap/Array) is shared
// across concurrent requests. Different users can read each other's data,
// and serverless cold-starts produce inconsistent state. Per-request data
// must live inside the action, in headers/cookies, or in a request scope
// (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState = defineRule({
  id: "server-no-mutable-module-state",
  title: "Mutable module state on the server",
  severity: "error",
  recommendation:
    "Keep per-request data inside the action, or in headers, cookies, or `React.cache`. Module-scope `let`/`var` is shared by every request.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;
    let programRoot: EsTreeNode | null = null;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
        programRoot = programNode;
      },
      VariableDeclaration(node: EsTreeNodeOfType<"VariableDeclaration">) {
        if (!fileHasUseServerDirective) return;
        if (!isNodeOfType(node.parent, "Program")) return;

        for (const declarator of node.declarations ?? []) {
          const variableName = isNodeOfType(declarator.id, "Identifier")
            ? declarator.id.name
            : "<unnamed>";

          if (node.kind === "let" || node.kind === "var") {
            context.report({
              node: declarator,
              message: `Module-scoped ${node.kind} "${variableName}" leaks state between your users, since every request shares it.`,
            });
            continue;
          }

          // const + mutable container — only a hazard when the contents are
          // actually mutated. A read-only lookup table / config shared across
          // requests is correct and idiomatic.
          const containerKind = isMutableConstInitializer(declarator.init);
          if (
            containerKind &&
            programRoot &&
            isNodeOfType(declarator.id, "Identifier") &&
            isContainerMutated(programRoot, declarator.id.name)
          ) {
            context.report({
              node: declarator,
              message: `Module-scoped const "${variableName} = ${containerKind}" leaks state between your users, since every request shares it.`,
            });
          }
        }
      },
    };
  },
});
