import {
  APP_DIRECTORY_PATTERN,
  EFFECT_HOOK_NAMES,
  EXECUTABLE_SCRIPT_TYPES,
  GOOGLE_FONTS_PATTERN,
  INTERNAL_PAGE_PATH_PATTERN,
  MUTATING_ROUTE_SEGMENTS,
  NEXTJS_NAVIGATION_FUNCTIONS,
  OG_ROUTE_PATTERN,
  PAGE_FILE_PATTERN,
  PAGE_OR_LAYOUT_FILE_PATTERN,
  PAGES_DIRECTORY_PATTERN,
  POLYFILL_SCRIPT_PATTERN,
  ROUTE_HANDLER_FILE_PATTERN,
} from "../constants.js";
import {
  containsFetchCall,
  findJsxAttribute,
  findSideEffect,
  getEffectCallback,
  hasDirective,
  hasJsxAttribute,
  isComponentAssignment,
  isHookCall,
  isMemberProperty,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const nextjsNoImgElement: Rule = {
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isOgRoute = OG_ROUTE_PATTERN.test(filename);

    return {
      JSXOpeningElement(node: EsTreeNode) {
        if (isOgRoute) return;
        if (node.name?.type === "JSXIdentifier" && node.name.name === "img") {
          context.report({
            node,
            message:
              "Use next/image instead of <img> — provides automatic optimization, lazy loading, and responsive srcset",
          });
        }
      },
    };
  },
};

export const nextjsAsyncClientComponent: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseClient = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseClient = hasDirective(programNode, "use client");
      },
      FunctionDeclaration(node: EsTreeNode) {
        if (!fileHasUseClient || !node.async) return;
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!fileHasUseClient) return;
        if (!isComponentAssignment(node) || !node.init?.async) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
    };
  },
};

export const nextjsNoAElement: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "a") return;

      const hrefAttribute = findJsxAttribute(node.attributes ?? [], "href");
      if (!hrefAttribute?.value) return;

      let hrefValue = null;
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
            "Use next/link instead of <a> for internal links — enables client-side navigation and prefetching",
        });
      }
    },
  }),
};

export const nextjsNoUseSearchParamsWithoutSuspense: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, "useSearchParams")) return;
      context.report({
        node,
        message:
          "useSearchParams() requires a <Suspense> boundary — without one, the entire page bails out to client-side rendering",
      });
    },
  }),
};

export const nextjsNoClientFetchForServerData: Rule = {
  create: (context: RuleContext) => {
    let fileHasUseClient = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseClient = hasDirective(programNode, "use client");
      },
      CallExpression(node: EsTreeNode) {
        if (!fileHasUseClient || !isHookCall(node, EFFECT_HOOK_NAMES)) return;

        const callback = getEffectCallback(node);
        if (!callback || !containsFetchCall(callback)) return;

        const filename = context.getFilename?.() ?? "";
        const isPageOrLayoutFile =
          PAGE_OR_LAYOUT_FILE_PATTERN.test(filename) || PAGES_DIRECTORY_PATTERN.test(filename);

        if (isPageOrLayoutFile) {
          context.report({
            node,
            message:
              "useEffect + fetch in a page/layout — fetch data server-side with a server component instead",
          });
        }
      },
    };
  },
};

export const nextjsMissingMetadata: Rule = {
  create: (context: RuleContext) => ({
    Program(programNode: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      if (!PAGE_FILE_PATTERN.test(filename)) return;
      if (INTERNAL_PAGE_PATH_PATTERN.test(filename)) return;

      const hasMetadataExport = programNode.body?.some((statement: EsTreeNode) => {
        if (statement.type !== "ExportNamedDeclaration") return false;
        const declaration = statement.declaration;
        if (declaration?.type === "VariableDeclaration") {
          return declaration.declarations?.some(
            (declarator: EsTreeNode) =>
              declarator.id?.type === "Identifier" &&
              (declarator.id.name === "metadata" || declarator.id.name === "generateMetadata"),
          );
        }
        if (declaration?.type === "FunctionDeclaration") {
          return declaration.id?.name === "generateMetadata";
        }
        return false;
      });

      if (!hasMetadataExport) {
        context.report({
          node: programNode,
          message: "Page without metadata or generateMetadata export — hurts SEO",
        });
      }
    },
  }),
};

const isClientSideRedirect = (node: EsTreeNode): boolean => {
  if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
    const objectName = node.callee.object?.type === "Identifier" ? node.callee.object.name : null;
    if (
      objectName === "router" &&
      (isMemberProperty(node.callee, "push") || isMemberProperty(node.callee, "replace"))
    )
      return true;
  }

  if (node.type === "AssignmentExpression" && node.left?.type === "MemberExpression") {
    const objectName = node.left.object?.type === "Identifier" ? node.left.object.name : null;
    const propertyName = node.left.property?.type === "Identifier" ? node.left.property.name : null;
    if (objectName === "window" && propertyName === "location") return true;
    if (objectName === "location" && propertyName === "href") return true;
  }

  return false;
};

export const nextjsNoClientSideRedirect: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      walkAst(callback, (child: EsTreeNode) => {
        if (isClientSideRedirect(child)) {
          context.report({
            node: child,
            message:
              "Client-side redirect in useEffect — use redirect() in a server component or middleware instead",
          });
        }
      });
    },
  }),
};

export const nextjsNoRedirectInTryCatch: Rule = {
  create: (context: RuleContext) => {
    let tryCatchDepth = 0;

    return {
      TryStatement() {
        tryCatchDepth++;
      },
      "TryStatement:exit"() {
        tryCatchDepth--;
      },
      CallExpression(node: EsTreeNode) {
        if (tryCatchDepth === 0) return;
        if (node.callee?.type !== "Identifier") return;
        if (!NEXTJS_NAVIGATION_FUNCTIONS.has(node.callee.name)) return;

        context.report({
          node,
          message: `${node.callee.name}() inside try-catch — this throws a special error Next.js handles internally. Move it outside the try block or use unstable_rethrow() in the catch`,
        });
      },
    };
  },
};

export const nextjsImageMissingSizes: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "Image") return;
      const attributes = node.attributes ?? [];
      if (!hasJsxAttribute(attributes, "fill")) return;
      if (hasJsxAttribute(attributes, "sizes")) return;

      context.report({
        node,
        message:
          "next/image with fill but no sizes — the browser downloads the largest image. Add a sizes attribute for responsive behavior",
      });
    },
  }),
};

export const nextjsNoNativeScript: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "script") return;

      const typeAttribute = findJsxAttribute(node.attributes ?? [], "type");
      const typeValue = typeAttribute?.value?.type === "Literal" ? typeAttribute.value.value : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;

      context.report({
        node,
        message:
          "Use next/script <Script> instead of <script> — provides loading strategy optimization and deferred loading",
      });
    },
  }),
};

export const nextjsInlineScriptMissingId: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "Script") return;
      const attributes = node.attributes ?? [];

      if (hasJsxAttribute(attributes, "src")) return;
      if (hasJsxAttribute(attributes, "id")) return;

      context.report({
        node,
        message:
          "Inline <Script> without id — Next.js requires an id attribute to track inline scripts",
      });
    },
  }),
};

export const nextjsNoFontLink: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;

      const hrefValue = hrefAttribute.value.type === "Literal" ? hrefAttribute.value.value : null;

      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) {
        context.report({
          node,
          message:
            "Loading Google Fonts via <link> — use next/font instead for self-hosting, zero layout shift, and no render-blocking requests",
        });
      }
    },
  }),
};

export const nextjsNoCssLink: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const relAttribute = findJsxAttribute(attributes, "rel");
      if (!relAttribute?.value) return;
      const relValue = relAttribute.value.type === "Literal" ? relAttribute.value.value : null;
      if (relValue !== "stylesheet") return;

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;
      const hrefValue = hrefAttribute.value.type === "Literal" ? hrefAttribute.value.value : null;
      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) return;

      context.report({
        node,
        message: '<link rel="stylesheet"> tag — import CSS directly for bundling and optimization',
      });
    },
  }),
};

export const nextjsNoPolyfillScript: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "script" && node.name.name !== "Script") return;

      const srcAttribute = findJsxAttribute(node.attributes ?? [], "src");
      if (!srcAttribute?.value) return;

      const srcValue = srcAttribute.value.type === "Literal" ? srcAttribute.value.value : null;

      if (typeof srcValue === "string" && POLYFILL_SCRIPT_PATTERN.test(srcValue)) {
        context.report({
          node,
          message:
            "Polyfill CDN script — Next.js includes polyfills for fetch, Promise, Object.assign, and 50+ others automatically",
        });
      }
    },
  }),
};

export const nextjsNoHeadImport: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "next/head") return;

      const filename = context.getFilename?.() ?? "";
      if (!APP_DIRECTORY_PATTERN.test(filename)) return;

      context.report({
        node,
        message: "next/head is not supported in the App Router — use the Metadata API instead",
      });
    },
  }),
};

const extractMutatingRouteSegment = (filename: string): string | null => {
  const segments = filename.split("/");
  for (const segment of segments) {
    const cleaned = segment.replace(/^\[.*\]$/, "");
    if (MUTATING_ROUTE_SEGMENTS.has(cleaned)) return cleaned;
  }
  return null;
};

const getExportedGetHandlerBody = (node: EsTreeNode): EsTreeNode | null => {
  if (node.type !== "ExportNamedDeclaration") return null;
  const declaration = node.declaration;
  if (!declaration) return null;

  if (declaration.type === "FunctionDeclaration" && declaration.id?.name === "GET") {
    return declaration.body;
  }

  if (declaration.type === "VariableDeclaration") {
    const declarator = declaration.declarations?.[0];
    if (
      declarator?.id?.type === "Identifier" &&
      declarator.id.name === "GET" &&
      declarator.init &&
      (declarator.init.type === "ArrowFunctionExpression" ||
        declarator.init.type === "FunctionExpression")
    ) {
      return declarator.init.body;
    }
  }

  return null;
};

export const nextjsNoSideEffectInGetHandler: Rule = {
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      if (!ROUTE_HANDLER_FILE_PATTERN.test(filename)) return;

      const handlerBody = getExportedGetHandlerBody(node);
      if (!handlerBody) return;

      const mutatingSegment = extractMutatingRouteSegment(filename);
      if (mutatingSegment) {
        context.report({
          node,
          message: `GET handler on "/${mutatingSegment}" route — use POST to prevent CSRF and unintended prefetch triggers`,
        });
        return;
      }

      const sideEffect = findSideEffect(handlerBody);
      if (sideEffect) {
        context.report({
          node,
          message: `GET handler has side effects (${sideEffect}) — use POST to prevent CSRF and unintended prefetch triggers`,
        });
      }
    },
  }),
};
