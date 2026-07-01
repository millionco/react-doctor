import { ROUTE_HANDLER_HTTP_METHODS } from "../../constants/nextjs.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

// Taint every binding derived from a handler param, transitively:
// `const { path: pathArray } = await params; const filePath = pathArray.join("/");
// const fullPath = path.join(cwd, filePath);` makes `fullPath` request-dependent,
// so `readFile(fullPath)` varies per request and must NOT be hoisted. Declarations
// are visited in document order, which covers const/let use-after-declare.
const collectRequestTaintedNames = (
  handlerBody: EsTreeNode,
  handlerParamNames: Set<string>,
): Set<string> => {
  const taintedNames = new Set(handlerParamNames);
  if (taintedNames.size === 0) return taintedNames;
  walkAst(handlerBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "VariableDeclaration")) return;
    for (const declarator of child.declarations ?? []) {
      if (!declarator.init) continue;
      const referencedNames = new Set<string>();
      collectReferenceIdentifierNames(declarator.init, referencedNames);
      if ([...referencedNames].some((name) => taintedNames.has(name))) {
        collectPatternNames(declarator.id, taintedNames);
      }
    }
  });
  return taintedNames;
};

const PAGES_ROUTER_API_PATH_PATTERN = /\/pages\/api\//;

const inspectHandlerBody = (
  context: RuleContext,
  handlerBody: EsTreeNode,
  handlerLabel: string,
  handlerParamNames: Set<string>,
): void => {
  const requestTaintedNames = collectRequestTaintedNames(handlerBody, handlerParamNames);
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
    if (callReadsHandlerArgs(staticCall, requestTaintedNames)) return;
    if (!isNodeOfType(staticCall, "CallExpression")) return;

    let calleeText = "io";
    if (
      isNodeOfType(staticCall.callee, "MemberExpression") &&
      isNodeOfType(staticCall.callee.property, "Identifier")
    ) {
      const objectName = isNodeOfType(staticCall.callee.object, "Identifier")
        ? staticCall.callee.object.name
        : "?";
      calleeText = `${objectName}.${staticCall.callee.property.name}`;
    } else if (isNodeOfType(staticCall.callee, "Identifier")) {
      calleeText = staticCall.callee.name;
    }
    context.report({
      node: staticCall,
      message: `${calleeText}() runs on every request in ${handlerLabel}, re-reading the same file each time.`,
    });
  });
};

// Collects every name a handler's params introduce, recursing into
// destructuring so `{ params }`, `{ params: p }`, `{ searchParams }`
// count as per-request handler args — a read whose path depends on one
// of these varies per request and must NOT be hoisted.
const collectHandlerParamNames = (params: EsTreeNode[]): Set<string> => {
  const names = new Set<string>();
  for (const param of params) collectPatternNames(param, names);
  return names;
};

// HACK: route handlers run on every request — reading static assets via
// `fs.readFileSync('./fonts/...')` or `fetch(new URL('./fonts/...',
// import.meta.url))` re-reads the same file from disk per request. We
// catch BOTH App Router (`export async function GET/POST/...` in
// `app/.../route.ts`) and Pages Router (`export default async function
// handler(req, res)` in `pages/api/...`).
export const serverHoistStaticIo = defineRule({
  id: "server-hoist-static-io",
  title: "Static file read on every request",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move the read to module scope so it runs once at load: `const FONT_DATA = await fetch(new URL('./fonts/Inter.ttf', import.meta.url)).then(r => r.arrayBuffer())`.",
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
        collectHandlerParamNames(declaration.params ?? []),
      );
    },
    ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
      const filename = normalizeFilename(context.filename ?? "");
      if (!PAGES_ROUTER_API_PATH_PATTERN.test(filename)) return;
      const declaration = node.declaration;
      if (!isFunctionLike(declaration)) return;
      if (!declaration.async) return;
      const body = declaration.body;
      if (!isNodeOfType(body, "BlockStatement")) return;
      inspectHandlerBody(
        context,
        body,
        "pages/api handler",
        collectHandlerParamNames(declaration.params ?? []),
      );
    },
  }),
});
