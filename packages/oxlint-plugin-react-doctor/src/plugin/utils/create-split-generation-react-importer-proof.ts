import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { readVerifiedStockViteBrowserProject } from "./read-verified-stock-vite-browser-project.js";
import type { RuleContext } from "./rule-context.js";

export interface SplitGenerationReactImporterInput {
  readonly context: RuleContext;
  readonly owner: EsTreeNode;
  readonly hookCall: EsTreeNodeOfType<"CallExpression">;
  readonly importDeclaration: EsTreeNodeOfType<"ImportDeclaration">;
  readonly importSpecifier: EsTreeNodeOfType<"ImportSpecifier">;
}

// Allocate once from the loading rule's create(context). The expensive project
// proof is lazy and is shared by that file's useRef and useState witnesses.
export type SplitGenerationReactImporterProof = (
  input: SplitGenerationReactImporterInput,
) => boolean;

export const createSplitGenerationReactImporterProof = (
  context: RuleContext,
): SplitGenerationReactImporterProof => {
  let qualified: boolean | undefined;
  return (input: SplitGenerationReactImporterInput): boolean => {
    const { hookCall, importDeclaration, importSpecifier, owner } = input;
    if (
      input.context !== context ||
      hookCall.optional ||
      !isNodeOfType(hookCall.callee, "Identifier") ||
      importDeclaration.importKind === "type" ||
      importDeclaration.source.value !== "react" ||
      importSpecifier.importKind === "type" ||
      importSpecifier.parent !== importDeclaration ||
      !isNodeOfType(importSpecifier.imported, "Identifier") ||
      !["useState", "useRef"].includes(importSpecifier.imported.name)
    )
      return false;
    const symbol = context.scopes.symbolFor(hookCall.callee);
    if (
      !symbol ||
      symbol.declarationNode !== importSpecifier ||
      context.scopes.symbolFor(importSpecifier.local) !== symbol
    )
      return false;
    let program: EsTreeNode = owner;
    while (program.parent) program = program.parent;
    if (
      !isNodeOfType(program, "Program") ||
      importDeclaration.parent !== program ||
      !hasCompleteSymbolReferences(symbol, program, context.scopes)
    )
      return false;
    let hookOwner: EsTreeNode | null | undefined = hookCall.parent;
    while (
      hookOwner &&
      !["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(
        hookOwner.type,
      )
    )
      hookOwner = hookOwner.parent;
    if (hookOwner !== owner) return false;
    const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (!root || !path.isAbsolute(root) || !context.filename) return false;
    const projectRoot = path.resolve(root);
    const filename = path.resolve(projectRoot, context.filename);
    if (!isPathInside(filename, projectRoot)) return false;
    if (qualified === undefined) {
      qualified =
        readVerifiedStockViteBrowserProject({
          projectRoot,
          filename,
          program,
          scopes: context.scopes,
        }) !== null;
    }
    return qualified;
  };
};
