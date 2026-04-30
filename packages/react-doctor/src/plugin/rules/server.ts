import { AUTH_CHECK_LOOKAHEAD_STATEMENTS, AUTH_FUNCTION_NAMES } from "../constants.js";
import { hasDirective, hasUseServerDirective, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const containsAuthCheck = (statements: EsTreeNode[]): boolean => {
  let foundAuthCall = false;
  for (const statement of statements) {
    walkAst(statement, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      let callNode: EsTreeNode | null = null;
      if (child.type === "CallExpression") {
        callNode = child;
      } else if (child.type === "AwaitExpression" && child.argument?.type === "CallExpression") {
        callNode = child.argument;
      }

      if (
        callNode?.callee?.type === "Identifier" &&
        AUTH_FUNCTION_NAMES.has(callNode.callee.name)
      ) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

export const serverAuthActions: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNode) {
        const declaration = node.declaration;
        if (declaration?.type !== "FunctionDeclaration" || !declaration?.async) return;

        const isServerAction = fileHasUseServerDirective || hasUseServerDirective(declaration);
        if (!isServerAction) return;

        const firstStatements = (declaration.body?.body ?? []).slice(
          0,
          AUTH_CHECK_LOOKAHEAD_STATEMENTS,
        );
        if (!containsAuthCheck(firstStatements)) {
          const functionName = declaration.id?.name ?? "anonymous";
          context.report({
            node: declaration.id ?? node,
            message: `Server action "${functionName}" — add auth check (auth(), getSession(), etc.) at the top`,
          });
        }
      },
    };
  },
};

// HACK: in `"use server"` files, mutable module-level state (let/var) is
// shared across concurrent requests. Different users can read each other's
// data, and serverless cold-starts produce inconsistent state. Per-request
// data must live inside the action, in headers/cookies, or in a request
// scope (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNode) {
        if (!fileHasUseServerDirective) return;
        // Only flag top-level (Program-direct) declarations.
        if (node.parent?.type !== "Program") return;
        if (node.kind !== "let" && node.kind !== "var") return;

        for (const declarator of node.declarations ?? []) {
          // Static literal initializers (e.g. `let count = 0`) are still
          // request-shared mutable state — flag them. But const/frozen
          // immutable singletons are fine (different rule kind).
          const variableName =
            declarator.id?.type === "Identifier" ? declarator.id.name : "<unnamed>";
          context.report({
            node: declarator,
            message: `Module-scoped ${node.kind} "${variableName}" in a "use server" file — this is shared across requests; move per-request data into the action body`,
          });
        }
      },
    };
  },
};

// HACK: `cache(fn)` from React keys deduplication on REFERENCE equality
// of the function arguments. Calling the cached function with object
// literals (`getUser({ id: 1 })` then `getUser({ id: 1 })`) creates two
// distinct argument objects per render, so the cache never hits and the
// underlying fetch runs twice per request. Pass primitives (or memoize
// the argument object once at module/route scope).
export const serverCacheWithObjectLiteral: Rule = {
  create: (context: RuleContext) => {
    const cachedFunctionNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNode) {
        if (node.id?.type !== "Identifier") return;
        const init = node.init;
        if (init?.type !== "CallExpression") return;
        const callee = init.callee;
        const isCacheCall =
          (callee?.type === "Identifier" && callee.name === "cache") ||
          (callee?.type === "MemberExpression" &&
            callee.object?.type === "Identifier" &&
            callee.object.name === "React" &&
            callee.property?.type === "Identifier" &&
            callee.property.name === "cache");
        if (!isCacheCall) return;
        cachedFunctionNames.add(node.id.name);
      },
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "Identifier") return;
        if (!cachedFunctionNames.has(node.callee.name)) return;
        const firstArg = node.arguments?.[0];
        if (firstArg?.type !== "ObjectExpression") return;

        context.report({
          node,
          message: `${node.callee.name} is React.cache()-wrapped, but you're passing an object literal — the cache keys on argument identity, so a fresh {} per render bypasses dedup. Pass primitives or hoist the object`,
        });
      },
    };
  },
};

export const serverAfterNonblocking: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;
    let serverFunctionDepth = 0;

    const enterIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth++;
    };
    const leaveIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth = Math.max(0, serverFunctionDepth - 1);
    };

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      FunctionDeclaration: enterIfServerFunction,
      "FunctionDeclaration:exit": leaveIfServerFunction,
      FunctionExpression: enterIfServerFunction,
      "FunctionExpression:exit": leaveIfServerFunction,
      ArrowFunctionExpression: enterIfServerFunction,
      "ArrowFunctionExpression:exit": leaveIfServerFunction,
      CallExpression(node: EsTreeNode) {
        if (!fileHasUseServerDirective && serverFunctionDepth === 0) return;
        if (node.callee?.type !== "MemberExpression") return;
        if (node.callee.property?.type !== "Identifier") return;

        const objectName =
          node.callee.object?.type === "Identifier" ? node.callee.object.name : null;
        if (!objectName) return;

        const methodName = node.callee.property.name;
        const isLoggingCall =
          (objectName === "console" &&
            (methodName === "log" || methodName === "info" || methodName === "warn")) ||
          (objectName === "analytics" &&
            (methodName === "track" || methodName === "identify" || methodName === "page"));
        if (!isLoggingCall) return;

        context.report({
          node,
          message: `${objectName}.${methodName}() in server action — use after() for non-blocking logging/analytics`,
        });
      },
    };
  },
};
