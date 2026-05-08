import { AUTH_CHECK_LOOKAHEAD_STATEMENTS, AUTH_FUNCTION_NAMES } from "../constants.js";
import { getRootIdentifierName, hasDirective, hasUseServerDirective, walkAst } from "../helpers.js";
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

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const isMutableConstInitializer = (init: EsTreeNode | null | undefined): string | null => {
  if (!init) return null;
  if (init.type === "ArrayExpression") return "[]";
  if (init.type === "ObjectExpression") return "{}";
  if (
    init.type === "NewExpression" &&
    init.callee?.type === "Identifier" &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(init.callee.name)
  ) {
    return `new ${init.callee.name}()`;
  }
  return null;
};

// HACK: in `"use server"` files, mutable module-level state (let/var, OR
// const-bound mutable containers like Map/Set/WeakMap/Array) is shared
// across concurrent requests. Different users can read each other's data,
// and serverless cold-starts produce inconsistent state. Per-request data
// must live inside the action, in headers/cookies, or in a request scope
// (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNode) {
        if (!fileHasUseServerDirective) return;
        if (node.parent?.type !== "Program") return;

        for (const declarator of node.declarations ?? []) {
          const variableName =
            declarator.id?.type === "Identifier" ? declarator.id.name : "<unnamed>";

          if (node.kind === "let" || node.kind === "var") {
            context.report({
              node: declarator,
              message: `Module-scoped ${node.kind} "${variableName}" in a "use server" file — this is shared across requests; move per-request data into the action body`,
            });
            continue;
          }

          // const + mutable container — same hazard, the binding is fixed
          // but the contents leak across requests.
          const containerKind = isMutableConstInitializer(declarator.init);
          if (containerKind) {
            context.report({
              node: declarator,
              message: `Module-scoped const "${variableName} = ${containerKind}" in a "use server" file — the container itself is shared across requests; move per-request data into the action body`,
            });
          }
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

// HACK: a (object, method) pair counts as "deferrable side effect" when
// it either (a) is a synchronous `console.log/info/warn` (still cheap,
// but the historical behavior of this rule and a real concern when many
// log lines pile up), or (b) is a known analytics/telemetry SDK method
// that genuinely costs a network round trip and IS worth wrapping in
// `after()` so it doesn't delay the user-visible response. Add provider
// names to the analytics object set as new SDKs come up.
const CONSOLE_DEFERRABLE_METHODS = new Set(["log", "info", "warn"]);
const ANALYTICS_DEFERRABLE_OBJECTS = new Set([
  "analytics",
  "posthog",
  "mixpanel",
  "segment",
  "amplitude",
  "datadog",
  "sentry",
]);
const ANALYTICS_DEFERRABLE_METHODS = new Set([
  "track",
  "identify",
  "page",
  "capture",
  "captureMessage",
  "captureException",
  "log",
]);

const isDeferrableSideEffectCall = (objectName: string, methodName: string): boolean => {
  if (objectName === "console") return CONSOLE_DEFERRABLE_METHODS.has(methodName);
  if (ANALYTICS_DEFERRABLE_OBJECTS.has(objectName)) {
    return ANALYTICS_DEFERRABLE_METHODS.has(methodName);
  }
  return false;
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
        if (!isDeferrableSideEffectCall(objectName, methodName)) return;

        context.report({
          node,
          message: `${objectName}.${methodName}() in server action — wrap in \`after(() => ${objectName}.${methodName}(...))\` so it doesn't delay the user-visible response`,
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

const expressionDerivesFromIdentifier = (node: EsTreeNode, identifierName: string): boolean => {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return false;
  if (callee.property?.type !== "Identifier") return false;
  if (!DERIVING_ARRAY_METHODS.has(callee.property.name)) return false;
  return getRootIdentifierName(callee, { followCallChains: true }) === identifierName;
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
          const root = getRootIdentifierName(expression, { followCallChains: true });
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

const PAGES_ROUTER_API_PATH_PATTERN = /\/pages\/api\//;

const inspectHandlerBody = (
  context: RuleContext,
  handlerBody: EsTreeNode,
  handlerLabel: string,
  handlerParamNames: Set<string>,
): void => {
  walkAst(handlerBody, (child: EsTreeNode) => {
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
            staticCall.callee.object?.type === "Identifier" ? staticCall.callee.object.name : "?"
          }.${staticCall.callee.property.name}`
        : staticCall.callee?.type === "Identifier"
          ? staticCall.callee.name
          : "io";
    context.report({
      node: staticCall,
      message: `${calleeText}() in ${handlerLabel} reads the same static asset every request — hoist to module scope so the read happens once at module load`,
    });
  });
};

const collectIdentifierParams = (params: EsTreeNode[]): Set<string> => {
  const names = new Set<string>();
  for (const param of params) {
    if (param.type === "Identifier") names.add(param.name);
  }
  return names;
};

// HACK: route handlers run on every request — reading static assets via
// `fs.readFileSync('./fonts/...')` or `fetch(new URL('./fonts/...',
// import.meta.url))` re-reads the same file from disk per request. We
// catch BOTH App Router (`export async function GET/POST/...` in
// `app/.../route.ts`) and Pages Router (`export default async function
// handler(req, res)` in `pages/api/...`).
export const serverHoistStaticIo: Rule = {
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNode) {
      const declaration = node.declaration;
      if (declaration?.type !== "FunctionDeclaration") return;
      const handlerName = declaration.id?.name;
      if (!handlerName || !ROUTE_HANDLER_HTTP_METHODS.has(handlerName)) return;
      if (declaration.body?.type !== "BlockStatement") return;
      inspectHandlerBody(
        context,
        declaration.body,
        `${handlerName} route handler`,
        collectIdentifierParams(declaration.params ?? []),
      );
    },
    ExportDefaultDeclaration(node: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      if (!PAGES_ROUTER_API_PATH_PATTERN.test(filename)) return;
      const declaration = node.declaration;
      if (
        !declaration ||
        (declaration.type !== "FunctionDeclaration" &&
          declaration.type !== "FunctionExpression" &&
          declaration.type !== "ArrowFunctionExpression")
      ) {
        return;
      }
      if (!declaration.async) return;
      const body = declaration.body;
      if (body?.type !== "BlockStatement") return;
      inspectHandlerBody(
        context,
        body,
        "pages/api handler",
        collectIdentifierParams(declaration.params ?? []),
      );
    },
  }),
};

// HACK: in async route handlers and Server Components, two consecutive
// `await fetch()` (or any awaited calls) where the second one doesn't
// reference the first's binding is a textbook waterfall — the second
// fetch waits for the first to land before even starting, doubling
// latency. Wrap independent awaits in `Promise.all([…])` so they race.
//
// Heuristic: scan async function bodies for two consecutive
// VariableDeclaration statements whose init is `await something(...)`,
// where the second's initializer reads no identifier introduced by the
// first declaration. We require both declarations to be at the top
// level of the same block to keep precision high.
const collectDeclaredNames = (declaration: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  for (const declarator of declaration.declarations ?? []) {
    if (declarator.id?.type === "Identifier") {
      names.add(declarator.id.name);
    } else if (declarator.id?.type === "ObjectPattern") {
      for (const property of declarator.id.properties ?? []) {
        if (property.type === "Property" && property.value?.type === "Identifier") {
          names.add(property.value.name);
        } else if (property.type === "RestElement" && property.argument?.type === "Identifier") {
          names.add(property.argument.name);
        }
      }
    } else if (declarator.id?.type === "ArrayPattern") {
      for (const element of declarator.id.elements ?? []) {
        if (element?.type === "Identifier") names.add(element.name);
      }
    }
  }
  return names;
};

const declarationStartsWithAwait = (declaration: EsTreeNode): boolean => {
  for (const declarator of declaration.declarations ?? []) {
    if (declarator.init?.type === "AwaitExpression") return true;
  }
  return false;
};

const declarationReadsAnyName = (declaration: EsTreeNode, names: Set<string>): boolean => {
  if (names.size === 0) return false;
  let didRead = false;
  walkAst(declaration, (child: EsTreeNode) => {
    if (didRead) return;
    if (child.type === "Identifier" && names.has(child.name)) didRead = true;
  });
  return didRead;
};

export const serverSequentialIndependentAwait: Rule = {
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const currentStatement = statements[statementIndex];
        if (currentStatement.type !== "VariableDeclaration") continue;
        if (!declarationStartsWithAwait(currentStatement)) continue;
        const declaredNames = collectDeclaredNames(currentStatement);

        const nextStatement = statements[statementIndex + 1];
        if (nextStatement.type !== "VariableDeclaration") continue;
        if (!declarationStartsWithAwait(nextStatement)) continue;

        if (declarationReadsAnyName(nextStatement, declaredNames)) continue;

        context.report({
          node: nextStatement,
          message:
            "Sequential `await` without a data dependency on the previous result — wrap the independent calls in `Promise.all([...])` so they race instead of waterfalling",
        });
        // Skip past the next so we don't double-report a chain.
        statementIndex++;
      }
    };

    const visitFunctionBody = (node: EsTreeNode): void => {
      if (!node.async) return;
      if (node.body?.type !== "BlockStatement") return;
      inspectStatements(node.body.body ?? []);
    };

    return {
      FunctionDeclaration: visitFunctionBody,
      FunctionExpression: visitFunctionBody,
      ArrowFunctionExpression: visitFunctionBody,
    };
  },
};

const isFetchCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  return node.callee?.type === "Identifier" && node.callee.name === "fetch";
};

const objectExpressionHasNextRevalidate = (objectExpression: EsTreeNode): boolean => {
  if (objectExpression.type !== "ObjectExpression") return false;
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    if (property.key?.type !== "Identifier") continue;
    if (property.key.name === "cache") return true;
    if (property.key.name !== "next") continue;
    if (property.value?.type !== "ObjectExpression") return true;
    for (const innerProperty of property.value.properties ?? []) {
      if (innerProperty.type !== "Property") continue;
      if (innerProperty.key?.type !== "Identifier") continue;
      if (innerProperty.key.name === "revalidate" || innerProperty.key.name === "tags") {
        return true;
      }
    }
    return true;
  }
  return false;
};

// HACK: in Next.js (App Router), `fetch(url)` inside a Server Component
// or route handler is cached *forever* by default unless the response
// is dynamic. The fix is to set `next: { revalidate: <seconds> }` (or
// `cache: "no-store"` for fully dynamic data, or `next: { tags: [...] }`
// for tag-based invalidation). Forgetting this is a common silent-stale
// data bug.
//
// Heuristic: `fetch(url)` in an App Router file (`app/.../route.ts(x)`,
// `app/.../page.ts(x)`, `app/.../layout.ts(x)`) without a config object —
// or with a config object that omits both `cache` and
// `next.revalidate`/`next.tags`. We can't reliably know "this is a
// Server Component" from the AST alone, so we approximate by:
//   1. Path contains `/app/` AND filename matches one of the App Router
//      file shapes (route|page|layout|template|loading|error|default
//      with .ts(x)? extension), AND
//   2. The file does not start with a `"use client"` directive, AND
//   3. The path does not pass through `node_modules/` or `dist/`
//      (vendored or built code).
const APP_ROUTER_FILE_PATTERN =
  /\/app\/(?:[^/]+\/)*(?:route|page|layout|template|loading|error|default)\.(?:tsx?|jsx?)$/;
const NON_PROJECT_PATH_PATTERN = /\/(?:node_modules|dist|build|\.next)\//;

export const serverFetchWithoutRevalidate: Rule = {
  create: (context: RuleContext) => {
    let isServerSideFile = false;

    return {
      Program(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!APP_ROUTER_FILE_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        if (NON_PROJECT_PATH_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        const hasUseClient = (node.body ?? []).some(
          (statement: EsTreeNode) =>
            statement.type === "ExpressionStatement" &&
            statement.expression?.type === "Literal" &&
            statement.expression.value === "use client",
        );
        isServerSideFile = !hasUseClient;
      },
      CallExpression(node: EsTreeNode) {
        if (!isServerSideFile) return;
        if (!isFetchCall(node)) return;

        const optionsArg = node.arguments?.[1];
        if (optionsArg && objectExpressionHasNextRevalidate(optionsArg)) return;

        const urlArg = node.arguments?.[0];
        const urlText =
          urlArg?.type === "Literal" && typeof urlArg.value === "string"
            ? `"${urlArg.value}"`
            : "url";
        context.report({
          node,
          message: `fetch(${urlText}) in a Server Component / route handler defaults to forever-caching — pass { next: { revalidate: <seconds> } } / { next: { tags: [...] } } / { cache: "no-store" } so stale data doesn't quietly persist`,
        });
      },
    };
  },
};
