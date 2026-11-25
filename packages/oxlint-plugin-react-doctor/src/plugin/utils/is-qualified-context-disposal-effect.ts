import { getContextDisposalFactoryCall } from "./get-context-disposal-factory-call.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { getContextTimeoutCallback } from "./get-context-timeout-callback.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getReactUseCallbackCall } from "./get-react-use-callback-call.js";
import { hasQualifiedViteContextTimer } from "./qualify-vite-context-timer.js";
import { hasUnsafeArrayIterationIntrinsics } from "./has-unsafe-array-iteration-intrinsics.js";
import { isDeferredDisposalFactory } from "./is-deferred-disposal-factory.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookCall } from "./is-react-hook-call.js";
import { isRefForwardingCallbackFactory } from "./is-ref-forwarding-callback-factory.js";
import { isSetterIdentifier } from "./is-setter-identifier.js";
import { readCuratedViteSourceProject } from "./read-curated-vite-source-project.js";
import { readOwnedContextSubscription } from "./read-owned-context-subscription.js";
import { resolveDirectLexicalImport } from "./resolve-direct-lexical-import.js";
import { getStableLexicalBindingValue } from "./get-stable-lexical-binding-value.js";
import { resolveOwnedReactContextFromGetter } from "./resolve-owned-react-context.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";
import { shouldUseCuratedPortBehavior } from "./should-use-curated-port-behavior.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkInsideStatementBlocks } from "./walk-inside-statement-blocks.js";

export const createContextDisposalEffectCheck = (context: RuleContext) => {
  let project: ReturnType<typeof readCuratedViteSourceProject> | undefined;
  const accepted = new WeakMap<EsTreeNode, boolean>();
  return (callback: EsTreeNode): boolean => {
    if (!shouldUseCuratedPortBehavior(context.settings)) return false;
    const cached = accepted.get(callback);
    if (cached !== undefined) return cached;
    const check = (): boolean => {
      const call = getContextDisposalFactoryCall(callback);
      if (!call) return false;
      const cleanupImport = resolveDirectLexicalImport(call.callee, context.scopes);
      if (
        !cleanupImport?.importedName ||
        cleanupImport.isNamespace ||
        !cleanupImport.source.startsWith(".")
      )
        return false;
      if (project === undefined) project = readCuratedViteSourceProject(context);
      const focal = project?.modulesByFilePath.get(project.focal);
      if (!project || !focal) return false;
      const factory = resolveVerifiedViteExport(
        project,
        focal,
        cleanupImport.source,
        cleanupImport.importedName,
      );
      if (!factory || !isDeferredDisposalFactory(factory.module, factory.exportedNode))
        return false;
      if (
        [...project.modulesByFilePath.values()].some((module) =>
          hasUnsafeArrayIterationIntrinsics(module.programNode, module.scopes),
        )
      )
        return false;
      let timerFound = false;
      const pending: EsTreeNode[] = [];
      const visited = new Set<EsTreeNode>();
      const qualifyTimer = (node: EsTreeNode) => {
        const timer = getContextTimeoutCallback(node, context.scopes);
        const caller = node.parent;
        const timerBinding = isNodeOfType(caller, "CallExpression")
          ? context.scopes.symbolFor(caller.callee)
          : null;
        const declaration = timerBinding?.declarationNode;
        const init =
          isNodeOfType(declaration, "VariableDeclarator") && declaration.init
            ? stripParenExpression(declaration.init)
            : null;
        if (
          !isNodeOfType(init, "CallExpression") ||
          !resolveDirectLexicalImport(init.callee, context.scopes)
        )
          return null;
        return timer && hasQualifiedViteContextTimer(project!, focal, timer.getter) ? timer : null;
      };
      const localBody = (input: EsTreeNode): EsTreeNode | null => {
        if (isFunctionLike(input)) return input;
        if (!isNodeOfType(input, "Identifier")) return null;
        const symbol = context.scopes.symbolFor(input);
        const init = symbol && getStableLexicalBindingValue(symbol, context.scopes);
        if (!init) return null;
        if (isFunctionLike(init)) return init;
        const stable = getReactUseCallbackCall(input, context.scopes);
        if (stable && isFunctionLike(stable.arguments[0])) return stable.arguments[0];
        if (
          isNodeOfType(init, "CallExpression") &&
          !init.optional &&
          init.arguments.length === 1 &&
          isFunctionLike(init.arguments[0])
        ) {
          const imported = resolveDirectLexicalImport(init.callee, context.scopes);
          const resolved =
            imported?.importedName &&
            !imported.isNamespace &&
            resolveVerifiedViteExport(project!, focal, imported.source, imported.importedName);
          if (resolved && isRefForwardingCallbackFactory(resolved.module, resolved.exportedNode))
            return init.arguments[0];
        }
        return null;
      };
      for (const arg of call.arguments) {
        if (isNodeOfType(arg, "Identifier")) {
          const fn = localBody(arg);
          if (!fn) return false;
          pending.push(fn);
          continue;
        }
        if (
          !isNodeOfType(arg, "CallExpression") ||
          arg.optional ||
          !isNodeOfType(arg.callee, "Identifier") ||
          arg.arguments.length !== 2 ||
          !isFunctionLike(arg.arguments[1])
        )
          return false;
        const symbol = context.scopes.symbolFor(arg.callee);
        const declaration = symbol?.declarationNode;
        if (
          symbol?.kind !== "const" ||
          symbol.references.some((ref) => ref.flag !== "read") ||
          !isNodeOfType(declaration, "VariableDeclarator") ||
          !isNodeOfType(declaration.id, "ObjectPattern") ||
          !declaration.init ||
          getDestructuredBindingPropertyName(symbol.bindingIdentifier) !== "subscribe"
        )
          return false;
        const getterCall = stripParenExpression(declaration.init);
        if (
          !isNodeOfType(getterCall, "CallExpression") ||
          getterCall.optional ||
          getterCall.arguments.length
        )
          return false;
        const getter = resolveDirectLexicalImport(getterCall.callee, context.scopes);
        if (!getter?.importedName || getter.isNamespace) return false;
        const resolved = resolveVerifiedViteExport(
          project,
          focal,
          getter.source,
          getter.importedName,
        );
        const owned = resolved && resolveOwnedReactContextFromGetter(project, resolved);
        if (!owned || !readOwnedContextSubscription(owned, { isNativeArrayPush: () => true }))
          return false;
        pending.push(arg.arguments[1]);
      }
      while (pending.length) {
        const fn = pending.pop()!;
        if (visited.has(fn)) continue;
        if (visited.size >= 32 || !isFunctionLike(fn) || fn.async || fn.generator) return false;
        visited.add(fn);
        let invalid = false;
        walkInsideStatementBlocks(fn.body, (node) => {
          if (!isNodeOfType(node, "CallExpression") || invalid) return;
          if (node.optional) {
            invalid = true;
            return;
          }
          const timer = node.arguments[0] && qualifyTimer(node.arguments[0]);
          if (timer) {
            timerFound = true;
            return;
          }
          const invoked = localBody(node.callee);
          if (invoked) {
            pending.push(invoked);
            return;
          }
          if (isNodeOfType(node.callee, "Identifier") && !isSetterIdentifier(node.callee.name)) {
            const symbol = context.scopes.symbolFor(node.callee);
            const decl = symbol?.declarationNode;
            if (
              symbol &&
              getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "clearTimeout" &&
              isNodeOfType(decl, "VariableDeclarator") &&
              decl.init &&
              isNodeOfType(decl.init, "CallExpression")
            ) {
              const getter = resolveDirectLexicalImport(decl.init.callee, context.scopes);
              if (getter && hasQualifiedViteContextTimer(project!, focal, getter)) return;
            }
          }
          invalid = true;
        });
        if (invalid) return false;
      }
      return timerFound;
    };
    const result = check();
    accepted.set(callback, result);
    return result;
  };
};
