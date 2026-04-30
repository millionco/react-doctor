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

const ROUTE_HANDLER_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

const STATIC_IO_FUNCTIONS = new Set([
  "readFileSync",
  "readFile",
  "readdir",
  "readdirSync",
  "stat",
  "statSync",
  "access",
  "accessSync",
]);

const isStaticIoCall = (call: EsTreeNode): boolean => {
  // fs.readFileSync(...) / fsPromises.readFile(...) / fs.promises.readFile(...).
  if (call.type !== "CallExpression") return false;
  const callee = call.callee;
  if (callee?.type === "Identifier" && STATIC_IO_FUNCTIONS.has(callee.name)) {
    return true;
  }
  if (callee?.type !== "MemberExpression") return false;
  const propertyName = callee.property?.type === "Identifier" ? callee.property.name : null;
  if (!propertyName || !STATIC_IO_FUNCTIONS.has(propertyName)) return false;
  return true;
};

const isFetchOfImportMetaUrl = (call: EsTreeNode): boolean => {
  // fetch(new URL("./fonts/Inter.ttf", import.meta.url))
  if (call.type !== "CallExpression") return false;
  if (call.callee?.type !== "Identifier" || call.callee.name !== "fetch") return false;
  const arg = call.arguments?.[0];
  if (!arg) return false;
  if (arg.type !== "NewExpression") return false;
  if (arg.callee?.type !== "Identifier" || arg.callee.name !== "URL") return false;
  const secondArg = arg.arguments?.[1];
  if (!secondArg) return false;
  // Match `import.meta.url` — MemberExpression on MetaProperty.
  return (
    secondArg.type === "MemberExpression" &&
    secondArg.object?.type === "MetaProperty" &&
    secondArg.property?.type === "Identifier" &&
    secondArg.property.name === "url"
  );
};

const callReadsHandlerArgs = (call: EsTreeNode, handlerParamNames: Set<string>): boolean => {
  if (handlerParamNames.size === 0) return false;
  let referencesArg = false;
  walkAst(call, (child: EsTreeNode) => {
    if (referencesArg) return;
    if (child.type === "Identifier" && handlerParamNames.has(child.name)) {
      referencesArg = true;
    }
  });
  return referencesArg;
};

const DERIVING_ARRAY_METHODS = new Set(["toSorted", "toReversed", "filter", "map", "slice"]);

const getRootIdentifierName = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode = node;
  while (cursor && (cursor.type === "MemberExpression" || cursor.type === "CallExpression")) {
    if (cursor.type === "MemberExpression") {
      cursor = cursor.object;
    } else if (cursor.type === "CallExpression") {
      const callee = cursor.callee;
      if (callee?.type === "MemberExpression") {
        cursor = callee.object;
      } else {
        return null;
      }
    }
  }
  return cursor?.type === "Identifier" ? cursor.name : null;
};

const expressionDerivesFromIdentifier = (node: EsTreeNode, identifierName: string): boolean => {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return false;
  if (callee.property?.type !== "Identifier") return false;
  if (!DERIVING_ARRAY_METHODS.has(callee.property.name)) return false;
  return getRootIdentifierName(callee) === identifierName;
};

// HACK: passing both `<Client list={items} sortedList={items.toSorted()} />`
// (or any pair of derivations of the same source) doubles the bytes
// React serializes across the RSC wire. The client gets two copies of
// roughly the same array; one of the props is redundant. Have the
// client derive what it needs from the single source prop instead.
export const serverDedupProps: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const identifierAttributes: Map<string, string> = new Map();
      const derivedAttributes: Array<{ propName: string; rootName: string; node: EsTreeNode }> = [];

      for (const attr of node.attributes ?? []) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name?.type !== "JSXIdentifier") continue;
        if (attr.value?.type !== "JSXExpressionContainer") continue;
        const expression = attr.value.expression;
        if (!expression) continue;

        if (expression.type === "Identifier") {
          identifierAttributes.set(expression.name, attr.name.name);
        } else if (expression.type === "CallExpression") {
          const root = getRootIdentifierName(expression);
          if (root && DERIVING_ARRAY_METHODS.has(getDerivingMethodName(expression) ?? "")) {
            if (expressionDerivesFromIdentifier(expression, root)) {
              derivedAttributes.push({ propName: attr.name.name, rootName: root, node: attr });
            }
          }
        }
      }

      for (const derived of derivedAttributes) {
        const sourcePropName = identifierAttributes.get(derived.rootName);
        if (sourcePropName) {
          context.report({
            node: derived.node,
            message: `"${derived.propName}" is derived from "${sourcePropName}" (same source: ${derived.rootName}) — passing both doubles RSC serialization. Pass the source once and derive on the client`,
          });
        }
      }
    },
  }),
};

const getDerivingMethodName = (node: EsTreeNode): string | null => {
  if (node.type !== "CallExpression") return null;
  if (node.callee?.type !== "MemberExpression") return null;
  if (node.callee.property?.type !== "Identifier") return null;
  return node.callee.property.name;
};

// HACK: route handlers (`export async function GET(request) { ... }` in
// app/route.ts files) run on every request. Reading static assets via
// `fs.readFileSync('./fonts/...')` or `fetch(new URL('./fonts/...',
// import.meta.url))` re-reads the same file from disk per request. For
// truly static input, hoist the read to module scope so the file is read
// once at module load.
export const serverHoistStaticIo: Rule = {
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNode) {
      const declaration = node.declaration;
      if (declaration?.type !== "FunctionDeclaration") return;
      const handlerName = declaration.id?.name;
      if (!handlerName || !ROUTE_HANDLER_HTTP_METHODS.has(handlerName)) return;

      const handlerParamNames = new Set<string>();
      for (const param of declaration.params ?? []) {
        if (param.type === "Identifier") handlerParamNames.add(param.name);
      }

      if (declaration.body?.type !== "BlockStatement") return;
      walkAst(declaration.body, (child: EsTreeNode) => {
        let staticCall: EsTreeNode | null = null;
        if (isStaticIoCall(child)) staticCall = child;
        else if (isFetchOfImportMetaUrl(child)) staticCall = child;
        else if (
          child.type === "AwaitExpression" &&
          child.argument &&
          (isStaticIoCall(child.argument) || isFetchOfImportMetaUrl(child.argument))
        ) {
          staticCall = child.argument;
        }
        if (!staticCall) return;
        if (callReadsHandlerArgs(staticCall, handlerParamNames)) return;

        const calleeText =
          staticCall.callee?.type === "MemberExpression" &&
          staticCall.callee.property?.type === "Identifier"
            ? `${
                staticCall.callee.object?.type === "Identifier"
                  ? staticCall.callee.object.name
                  : "?"
              }.${staticCall.callee.property.name}`
            : staticCall.callee?.type === "Identifier"
              ? staticCall.callee.name
              : "io";
        context.report({
          node: staticCall,
          message: `${calleeText}() in ${handlerName} route handler reads the same static asset every request — hoist to module scope so the read happens once at module load`,
        });
      });
    },
  }),
};
