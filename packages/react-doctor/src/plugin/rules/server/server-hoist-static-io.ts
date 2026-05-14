import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = call.callee;
  if (isNodeOfType(callee, "Identifier") && STATIC_IO_FUNCTIONS.has(callee.name)) {
    return true;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = isNodeOfType(callee.property, "Identifier") ? callee.property.name : null;
  if (!propertyName || !STATIC_IO_FUNCTIONS.has(propertyName)) return false;
  return true;
};

const isFetchOfImportMetaUrl = (call: EsTreeNode): boolean => {
  // fetch(new URL("./fonts/Inter.ttf", import.meta.url))
  if (!isNodeOfType(call, "CallExpression")) return false;
  if (!isNodeOfType(call.callee, "Identifier") || call.callee.name !== "fetch") return false;
  const arg = call.arguments?.[0];
  if (!arg) return false;
  if (!isNodeOfType(arg, "NewExpression")) return false;
  if (!isNodeOfType(arg.callee, "Identifier") || arg.callee.name !== "URL") return false;
  const secondArg = arg.arguments?.[1];
  if (!secondArg) return false;
  // Match `import.meta.url` — MemberExpression on MetaProperty.
  return (
    isNodeOfType(secondArg, "MemberExpression") &&
    isNodeOfType(secondArg.object, "MetaProperty") &&
    isNodeOfType(secondArg.property, "Identifier") &&
    secondArg.property.name === "url"
  );
};

const callReadsHandlerArgs = (call: EsTreeNode, handlerParamNames: Set<string>): boolean => {
  if (handlerParamNames.size === 0) return false;
  let referencesArg = false;
  walkAst(call, (child: EsTreeNode) => {
    if (referencesArg) return;
    if (isNodeOfType(child, "Identifier") && handlerParamNames.has(child.name)) {
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
      isNodeOfType(child, "AwaitExpression") &&
      child.argument &&
      (isStaticIoCall(child.argument) || isFetchOfImportMetaUrl(child.argument))
    ) {
      staticCall = child.argument;
    }
    if (!staticCall) return;
    if (callReadsHandlerArgs(staticCall, handlerParamNames)) return;
    if (!isNodeOfType(staticCall, "CallExpression")) return;

    const calleeText =
      isNodeOfType(staticCall.callee, "MemberExpression") &&
      isNodeOfType(staticCall.callee.property, "Identifier")
        ? `${
            isNodeOfType(staticCall.callee.object, "Identifier")
              ? staticCall.callee.object.name
              : "?"
          }.${staticCall.callee.property.name}`
        : isNodeOfType(staticCall.callee, "Identifier")
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
    if (isNodeOfType(param, "Identifier")) names.add(param.name);
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
  id: "server-hoist-static-io",
  framework: "global",
  severity: "warn",
  category: "Server",
  recommendation:
    "Hoist the read to module scope: `const FONT_DATA = await fetch(new URL('./fonts/Inter.ttf', import.meta.url)).then(r => r.arrayBuffer())` runs once at module load",
  examples: [
    {
      before:
        "export async function GET() {\n  const data = await fs.readFile('./static/data.json', 'utf8');\n  return Response.json(JSON.parse(data));\n}",
      after:
        "const DATA = JSON.parse(await fs.readFile('./static/data.json', 'utf8'));\nexport async function GET() { return Response.json(DATA); }",
    },
  ],
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
      const declaration = node.declaration;
      if (!isNodeOfType(declaration, "FunctionDeclaration")) return;
      const handlerName = declaration.id?.name;
      if (!handlerName || !ROUTE_HANDLER_HTTP_METHODS.has(handlerName)) return;
      if (!isNodeOfType(declaration.body, "BlockStatement")) return;
      inspectHandlerBody(
        context,
        declaration.body,
        `${handlerName} route handler`,
        collectIdentifierParams(declaration.params ?? []),
      );
    },
    ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
      const filename = context.getFilename?.() ?? "";
      if (!PAGES_ROUTER_API_PATH_PATTERN.test(filename)) return;
      const declaration = node.declaration;
      if (
        !declaration ||
        (!isNodeOfType(declaration, "FunctionDeclaration") &&
          !isNodeOfType(declaration, "FunctionExpression") &&
          !isNodeOfType(declaration, "ArrowFunctionExpression"))
      ) {
        return;
      }
      if (!declaration.async) return;
      const body = declaration.body;
      if (!isNodeOfType(body, "BlockStatement")) return;
      inspectHandlerBody(
        context,
        body,
        "pages/api handler",
        collectIdentifierParams(declaration.params ?? []),
      );
    },
  }),
});
