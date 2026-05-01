import {
  EFFECT_HOOK_NAMES,
  MUTATING_HTTP_METHODS,
  SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER,
  TANSTACK_MIDDLEWARE_METHOD_ORDER,
  TANSTACK_REDIRECT_FUNCTIONS,
  TANSTACK_ROUTE_CREATION_FUNCTIONS,
  TANSTACK_ROUTE_FILE_PATTERN,
  TANSTACK_ROUTE_PROPERTY_ORDER,
  TANSTACK_ROOT_ROUTE_FILE_PATTERN,
  TANSTACK_SERVER_FN_FILE_PATTERN,
  TANSTACK_SERVER_FN_NAMES,
  UPPERCASE_PATTERN,
} from "../constants.js";
import { findSideEffect, getCalleeName, isHookCall, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const getRouteOptionsObject = (node: EsTreeNode): EsTreeNode | null => {
  if (node.type !== "CallExpression") return null;

  const callee = node.callee;

  if (callee?.type === "CallExpression" && callee.callee?.type === "Identifier") {
    if (!TANSTACK_ROUTE_CREATION_FUNCTIONS.has(callee.callee.name)) return null;
    const optionsArgument = node.arguments?.[0];
    if (optionsArgument?.type === "ObjectExpression") return optionsArgument;
    return null;
  }

  if (callee?.type === "Identifier") {
    if (!TANSTACK_ROUTE_CREATION_FUNCTIONS.has(callee.name)) return null;
    const optionsArgument = node.arguments?.[0];
    if (optionsArgument?.type === "ObjectExpression") return optionsArgument;
    return null;
  }

  return null;
};

const getPropertyKeyName = (property: EsTreeNode): string | null => {
  if (property.type !== "Property" && property.type !== "MethodDefinition") return null;
  if (property.key?.type === "Identifier") return property.key.name;
  if (property.key?.type === "Literal") return String(property.key.value);
  return null;
};

interface ServerFnChainInfo {
  isServerFnChain: boolean;
  specifiedMethod: string | null;
  hasInputValidator: boolean;
}

const walkServerFnChain = (outerNode: EsTreeNode): ServerFnChainInfo => {
  const result: ServerFnChainInfo = {
    isServerFnChain: false,
    specifiedMethod: null,
    hasInputValidator: false,
  };

  let currentNode: EsTreeNode = outerNode.callee?.object;

  while (currentNode?.type === "CallExpression") {
    const calleeName = getCalleeName(currentNode);

    if (calleeName && TANSTACK_SERVER_FN_NAMES.has(calleeName)) {
      result.isServerFnChain = true;

      const optionsArgument = currentNode.arguments?.[0];
      if (optionsArgument?.type === "ObjectExpression") {
        for (const property of optionsArgument.properties ?? []) {
          if (
            property.key?.type === "Identifier" &&
            property.key.name === "method" &&
            property.value?.type === "Literal" &&
            typeof property.value.value === "string"
          ) {
            result.specifiedMethod = property.value.value;
          }
        }
      }
    }

    if (calleeName === "inputValidator") {
      result.hasInputValidator = true;
    }

    if (currentNode.callee?.type === "MemberExpression") {
      currentNode = currentNode.callee.object;
    } else {
      break;
    }
  }

  return result;
};

export const tanstackStartRoutePropertyOrder: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties: EsTreeNode[] = optionsObject.properties ?? [];
      const orderedPropertyNames: string[] = [];
      for (const property of properties) {
        const propertyName = getPropertyKeyName(property);
        if (propertyName !== null) {
          orderedPropertyNames.push(propertyName);
        }
      }

      const sensitiveProperties = orderedPropertyNames.filter((propertyName) =>
        TANSTACK_ROUTE_PROPERTY_ORDER.includes(propertyName),
      );

      let lastIndex = -1;
      for (const propertyName of sensitiveProperties) {
        const currentIndex = TANSTACK_ROUTE_PROPERTY_ORDER.indexOf(propertyName);
        if (currentIndex < lastIndex) {
          const expectedBefore = TANSTACK_ROUTE_PROPERTY_ORDER[lastIndex];
          context.report({
            node: optionsObject,
            message: `Route property "${propertyName}" must come before "${expectedBefore}" — wrong order breaks TypeScript type inference`,
          });
          return;
        }
        lastIndex = currentIndex;
      }
    },
  }),
};

export const tanstackStartNoDirectFetchInLoader: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;

        const loaderValue = property.value ?? property;
        walkAst(loaderValue, (child: EsTreeNode) => {
          if (child.type !== "CallExpression") return;
          if (child.callee?.type === "Identifier" && child.callee.name === "fetch") {
            context.report({
              node: child,
              message:
                "Direct fetch() in route loader — use createServerFn() for type-safe server logic with automatic RPC",
            });
          }
        });
      }
    },
  }),
};

export const tanstackStartServerFnValidateInput: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "handler") return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;

      let accessesData = false;
      walkAst(handlerFunction, (child: EsTreeNode) => {
        if (
          child.type === "MemberExpression" &&
          child.property?.type === "Identifier" &&
          child.property.name === "data"
        ) {
          accessesData = true;
        }
        if (
          child.type === "ObjectPattern" &&
          child.properties?.some(
            (property: EsTreeNode) =>
              property.key?.type === "Identifier" && property.key.name === "data",
          )
        ) {
          accessesData = true;
        }
      });

      if (accessesData && !chainInfo.hasInputValidator) {
        context.report({
          node,
          message:
            "Server function handler accesses data without inputValidator() — validate inputs crossing the network boundary",
        });
      }
    },
  }),
};

export const tanstackStartNoUseEffectFetch: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      const isRouteFile = TANSTACK_ROUTE_FILE_PATTERN.test(filename);
      if (!isRouteFile) return;

      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = node.arguments?.[0];
      if (!callback) return;

      let hasFetchCall = false;
      walkAst(callback, (child: EsTreeNode) => {
        if (hasFetchCall) return;
        if (
          child.type === "CallExpression" &&
          child.callee?.type === "Identifier" &&
          child.callee.name === "fetch"
        ) {
          hasFetchCall = true;
        }
      });

      if (hasFetchCall) {
        context.report({
          node,
          message:
            "fetch() inside useEffect in a route file — use the route loader or createServerFn() instead",
        });
      }
    },
  }),
};

export const tanstackStartMissingHeadContent: Rule = {
  create: (context: RuleContext) => {
    let hasHeadContentElement = false;

    return {
      JSXOpeningElement(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (node.name?.type === "JSXIdentifier" && node.name.name === "HeadContent") {
          hasHeadContentElement = true;
        }
      },
      "Program:exit"(programNode: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (!hasHeadContentElement) {
          context.report({
            node: programNode,
            message:
              "Root route (__root) without <HeadContent /> — route head() meta tags won't render",
          });
        }
      },
    };
  },
};

export const tanstackStartNoAnchorElement: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      const isRouteFile = TANSTACK_ROUTE_FILE_PATTERN.test(filename);
      if (!isRouteFile) return;

      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "a") return;

      const attributes = node.attributes ?? [];
      const hrefAttribute = attributes.find(
        (attribute: EsTreeNode) =>
          attribute.type === "JSXAttribute" &&
          attribute.name?.type === "JSXIdentifier" &&
          attribute.name.name === "href",
      );

      if (!hrefAttribute?.value) return;

      let hrefValue: string | null = null;
      if (hrefAttribute.value.type === "Literal") {
        hrefValue = hrefAttribute.value.value;
      } else if (
        hrefAttribute.value.type === "JSXExpressionContainer" &&
        hrefAttribute.value.expression?.type === "Literal"
      ) {
        hrefValue = hrefAttribute.value.expression.value;
      }

      if (typeof hrefValue === "string" && hrefValue.startsWith("/")) {
        context.report({
          node,
          message:
            "Use <Link> from @tanstack/react-router instead of <a> for internal navigation — enables type-safe routing and preloading",
        });
      }
    },
  }),
};

export const tanstackStartServerFnMethodOrder: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;

      const methodNames: string[] = [];
      let currentNode: EsTreeNode = node;

      while (
        currentNode?.type === "CallExpression" &&
        currentNode.callee?.type === "MemberExpression"
      ) {
        const methodName =
          currentNode.callee.property?.type === "Identifier"
            ? currentNode.callee.property.name
            : null;
        if (methodName) methodNames.unshift(methodName);
        currentNode = currentNode.callee.object;
      }

      if (currentNode?.type === "CallExpression" && currentNode.callee?.type === "Identifier") {
        if (!TANSTACK_SERVER_FN_NAMES.has(currentNode.callee.name)) return;
      } else {
        return;
      }

      const ownMethodName =
        node.callee.property?.type === "Identifier" ? node.callee.property.name : null;
      if (methodNames[methodNames.length - 1] !== ownMethodName) return;

      const orderSensitiveMethods = methodNames.filter((name) =>
        TANSTACK_MIDDLEWARE_METHOD_ORDER.includes(name),
      );

      let lastIndex = -1;
      for (const methodName of orderSensitiveMethods) {
        const currentIndex = TANSTACK_MIDDLEWARE_METHOD_ORDER.indexOf(methodName);
        if (currentIndex < lastIndex) {
          const expectedBefore = TANSTACK_MIDDLEWARE_METHOD_ORDER[lastIndex];
          context.report({
            node,
            message: `Server function method .${methodName}() must come before .${expectedBefore}() — wrong order breaks type inference`,
          });
          return;
        }
        lastIndex = currentIndex;
      }
    },
  }),
};

export const tanstackStartNoNavigateInRender: Rule = {
  create: (context: RuleContext) => {
    // HACK: only callbacks that React calls LATER are safe scopes for
    // navigate() — useEffect / useLayoutEffect (post-commit), useCallback
    // / useMemo (cached, fired by event handlers later), and JSX `onXxx`
    // attributes (event handlers). Synchronous-iteration callbacks like
    // `arr.forEach(item => navigate(item))` execute during render, so
    // they must NOT be treated as deferred — they're still render-time
    // side effects. A pure function-depth counter would skip them and
    // miss real bugs; the explicit allow-list is the correct boundary.
    let deferredCallbackDepth = 0;
    let eventHandlerDepth = 0;

    const isDeferredHookCall = (node: EsTreeNode): boolean =>
      isHookCall(node, EFFECT_HOOK_NAMES) ||
      isHookCall(node, "useCallback") ||
      isHookCall(node, "useMemo");

    const isEventHandlerAttribute = (node: EsTreeNode): boolean =>
      node.name?.type === "JSXIdentifier" &&
      typeof node.name.name === "string" &&
      node.name.name.startsWith("on") &&
      UPPERCASE_PATTERN.test(node.name.name.charAt(2));

    return {
      CallExpression(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;

        if (isDeferredHookCall(node)) deferredCallbackDepth++;

        if (deferredCallbackDepth > 0 || eventHandlerDepth > 0) return;

        if (
          node.callee?.type === "Identifier" &&
          node.callee.name === "navigate" &&
          (node.arguments?.length ?? 0) > 0
        ) {
          context.report({
            node,
            message:
              "navigate() called during render — use redirect() in beforeLoad/loader for route-level redirects",
          });
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isDeferredHookCall(node)) {
          deferredCallbackDepth = Math.max(0, deferredCallbackDepth - 1);
        }
      },
      JSXAttribute(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) eventHandlerDepth++;
      },
      "JSXAttribute:exit"(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
    };
  },
};

export const tanstackStartNoDynamicServerFnImport: Rule = {
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNode) {
      const source = node.source;
      if (!source) return;

      let importPath: string | null = null;
      if (source.type === "Literal" && typeof source.value === "string") {
        importPath = source.value;
      } else if (source.type === "TemplateLiteral" && source.quasis?.length === 1) {
        importPath = source.quasis[0].value?.raw ?? null;
      }

      if (importPath && TANSTACK_SERVER_FN_FILE_PATTERN.test(importPath)) {
        context.report({
          node,
          message:
            "Dynamic import of server functions file — use static imports so the bundler can replace server code with RPC stubs",
        });
      }
    },
  }),
};

export const tanstackStartNoUseServerInHandler: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier" || node.callee.property.name !== "handler")
        return;

      const handlerFunction = node.arguments?.[0];
      if (
        !handlerFunction ||
        (handlerFunction.type !== "ArrowFunctionExpression" &&
          handlerFunction.type !== "FunctionExpression")
      )
        return;

      const body = handlerFunction.body;
      if (body?.type !== "BlockStatement") return;

      const hasUseServerDirective = body.body?.some(
        (statement: EsTreeNode) =>
          statement.type === "ExpressionStatement" &&
          (statement.directive === "use server" ||
            (statement.expression?.type === "Literal" &&
              statement.expression.value === "use server")),
      );

      if (hasUseServerDirective) {
        context.report({
          node: handlerFunction,
          message:
            '"use server" inside createServerFn handler — TanStack Start handles this automatically, remove the directive',
        });
      }
    },
  }),
};

const SAFE_BUILD_ENV_VARS = new Set(["NODE_ENV", "MODE", "DEV", "PROD"]);
const SECRET_KEYWORD_PATTERN = /(?:secret|token|api[_]?key|password|private)/i;

// HACK: only flag env vars whose name matches a secret keyword. A loader
// reading process.env.DATABASE_URL or process.env.PORT is fine; what's not
// fine is process.env.STRIPE_SECRET or process.env.NEXT_PUBLIC_API_KEY (the
// latter being a misconfigured public-prefixed key).
const isLikelySecret = (envVarName: string): boolean => {
  if (SAFE_BUILD_ENV_VARS.has(envVarName)) return false;
  return SECRET_KEYWORD_PATTERN.test(envVarName);
};

export const tanstackStartNoSecretsInLoader: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader" && keyName !== "beforeLoad") continue;

        const loaderValue = property.value ?? property;
        walkAst(loaderValue, (child: EsTreeNode) => {
          if (child.type !== "MemberExpression") return;
          const isProcessEnvAccess =
            child.object?.type === "MemberExpression" &&
            child.object.object?.type === "Identifier" &&
            child.object.object.name === "process" &&
            child.object.property?.type === "Identifier" &&
            child.object.property.name === "env";
          const isImportMetaEnvAccess =
            child.object?.type === "MemberExpression" &&
            child.object.object?.type === "MetaProperty" &&
            child.object.property?.type === "Identifier" &&
            child.object.property.name === "env";

          if (!isProcessEnvAccess && !isImportMetaEnvAccess) return;

          const envVarName = child.property?.type === "Identifier" ? child.property.name : null;
          if (envVarName && isLikelySecret(envVarName)) {
            const envSource = isImportMetaEnvAccess ? "import.meta.env" : "process.env";
            context.report({
              node: child,
              message: `${envSource}.${envVarName} in ${keyName} — loaders are isomorphic and may leak secrets to the client. Move to a createServerFn()`,
            });
          }
        });
      }
    },
  }),
};

export const tanstackStartGetMutation: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier" || node.callee.property.name !== "handler")
        return;

      const chainInfo = walkServerFnChain(node);
      if (!chainInfo.isServerFnChain) return;
      if (
        chainInfo.specifiedMethod &&
        MUTATING_HTTP_METHODS.has(chainInfo.specifiedMethod.toUpperCase())
      )
        return;

      const handlerFunction = node.arguments?.[0];
      if (!handlerFunction) return;

      const sideEffect = findSideEffect(handlerFunction);
      if (sideEffect) {
        context.report({
          node,
          message: `GET server function has side effects (${sideEffect}) — use createServerFn({ method: 'POST' }) for mutations`,
        });
      }
    },
  }),
};

export const tanstackStartRedirectInTryCatch: Rule = {
  create: (context: RuleContext) => {
    let tryBlockDepth = 0;
    let catchClauseDepth = 0;

    return {
      TryStatement() {
        tryBlockDepth++;
      },
      "TryStatement:exit"() {
        tryBlockDepth--;
      },
      CatchClause() {
        catchClauseDepth++;
      },
      "CatchClause:exit"() {
        catchClauseDepth--;
      },
      ThrowStatement(node: EsTreeNode) {
        if (tryBlockDepth === 0) return;
        if (catchClauseDepth > 0) return;

        const argument = node.argument;
        if (argument?.type !== "CallExpression") return;
        if (argument.callee?.type !== "Identifier") return;
        if (!TANSTACK_REDIRECT_FUNCTIONS.has(argument.callee.name)) return;

        context.report({
          node,
          message: `throw ${argument.callee.name}() inside try block — the router catches this internally. Move it outside the try block or re-throw in the catch`,
        });
      },
    };
  },
};

const hasTopLevelAwait = (statement: EsTreeNode): boolean => {
  if (statement.type === "VariableDeclaration") {
    return statement.declarations?.some(
      (declarator: EsTreeNode) => declarator.init?.type === "AwaitExpression",
    );
  }
  if (statement.type === "ExpressionStatement") {
    return (
      statement.expression?.type === "AwaitExpression" ||
      (statement.expression?.type === "AssignmentExpression" &&
        statement.expression.right?.type === "AwaitExpression")
    );
  }
  if (statement.type === "ReturnStatement") {
    return statement.argument?.type === "AwaitExpression";
  }
  if (statement.type === "ForOfStatement" && statement.await) {
    return true;
  }
  return false;
};

export const tanstackStartLoaderParallelFetch: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;

        const loaderValue = property.value;
        if (
          !loaderValue ||
          (loaderValue.type !== "ArrowFunctionExpression" &&
            loaderValue.type !== "FunctionExpression")
        )
          continue;

        const functionBody = loaderValue.body;
        if (!functionBody || functionBody.type !== "BlockStatement") continue;

        let sequentialAwaitCount = 0;
        for (const statement of functionBody.body ?? []) {
          if (hasTopLevelAwait(statement)) {
            sequentialAwaitCount++;
          }

          if (sequentialAwaitCount >= SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER) {
            context.report({
              node: property,
              message:
                "Multiple sequential awaits in loader — use Promise.all() to fetch data in parallel and avoid waterfalls",
            });
            break;
          }
        }
      }
    },
  }),
};
