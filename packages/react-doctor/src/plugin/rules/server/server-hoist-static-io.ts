import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

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
export const serverHoistStaticIo = defineRule<Rule>({
  recommendation:
    "Hoist the read to module scope: `const FONT_DATA = await fetch(new URL('./fonts/Inter.ttf', import.meta.url)).then(r => r.arrayBuffer())` runs once at module load",
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
});
