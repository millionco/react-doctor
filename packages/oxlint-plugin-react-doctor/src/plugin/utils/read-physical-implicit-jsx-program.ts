import * as fs from "node:fs";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const JSX_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;

const hasUnresolvedReactValue = (context: RuleContext): boolean => {
  const pending = [context.scopes.rootScope];
  while (pending.length > 0) {
    const scope = pending.pop();
    if (!scope) break;
    if (
      scope.references.some(
        ({ identifier }) =>
          isNodeOfType(identifier, "Identifier") &&
          identifier.name === "React" &&
          context.scopes.isGlobalReference(identifier),
      )
    ) {
      return true;
    }
    pending.push(...scope.children);
  }
  return false;
};

export const readPhysicalImplicitJsxProgram = (
  context: RuleContext,
  filename: string,
): EsTreeNodeOfType<"Program"> | null => {
  if (
    fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() !== true ||
    fs.realpathSync(filename) !== filename
  ) {
    return null;
  }
  const sourceText = context.getSourceText?.();
  if (
    sourceText === undefined ||
    JSX_PRAGMA.test(sourceText) ||
    sourceText !== fs.readFileSync(filename, "utf8") ||
    hasUnresolvedReactValue(context)
  ) {
    return null;
  }
  const program = context.scopes.rootScope.node;
  return isNodeOfType(program, "Program") ? program : null;
};
