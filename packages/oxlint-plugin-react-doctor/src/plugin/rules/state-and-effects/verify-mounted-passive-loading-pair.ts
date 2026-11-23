import * as path from "node:path";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPathInside } from "../../utils/is-path-inside.js";
import { readReadonlyReactContextAsyncField } from "../../utils/read-readonly-react-context-async-field.js";
import { readVerifiedStockViteBrowserProject } from "../../utils/read-verified-stock-vite-browser-project.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { hasNoOtherMountedLoadingTests } from "./has-no-other-mounted-loading-tests.js";
import { readLoadingAsyncOwnershipBrowserCaller } from "./read-loading-async-ownership-browser-caller.js";
import { readLoadingAsyncOwnershipJest } from "./read-loading-async-ownership-jest.js";
import type { MountedLoadingScope } from "./read-passive-loading-pair.js";

export const verifyMountedPassiveLoadingPair = (
  pair: MountedLoadingScope,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const program = context.scopes.rootScope.node;
  const hook = pair.contextHookCall;
  const hookSymbol = context.scopes.symbolFor(hook.callee);
  const specifier = hookSymbol?.declarationNode;
  const imported = hookSymbol && getImportDeclarationForSymbol(hookSymbol);
  const name = getFunctionBindingName(owner);
  const hookPosition = getRangeStart(hook);

  if (
    !root ||
    !path.isAbsolute(root) ||
    !context.filename ||
    !isNodeOfType(program, "Program") ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    !imported ||
    typeof imported.source.value !== "string" ||
    !name ||
    hookPosition === null ||
    findExportedValue(program, "default") !== owner
  ) {
    return false;
  }
  const projectRoot = path.resolve(root);
  const filename = path.resolve(projectRoot, context.filename);
  if (!isPathInside(filename, projectRoot)) return false;

  const importedHook = specifier.imported.name;
  const importedSource = imported.source.value;
  let testFile: string | undefined;
  const project = readVerifiedStockViteBrowserProject({
    projectRoot,
    filename,
    program,
    scopes: context.scopes,
    inspectProject: (inspection) => {
      const focal = inspection.index.modulesByFilePath.get(filename);
      if (!focal) return null;
      const exported = findExportedValue(focal.programNode, "default");
      if (!exported || getFunctionBindingName(exported) !== name) return null;
      const caller = readLoadingAsyncOwnershipBrowserCaller({
        project: inspection,
        focal,
        owner: exported,
        openProperty: pair.openProperty,
        viewProperty: pair.viewProperty,
      });
      if (!caller || caller.directNamedTestCandidates.length !== 1) return null;

      const selected: EsTreeNodeOfType<"CallExpression">[] = [];
      walkAst(exported, (node) => {
        if (
          !isNodeOfType(node, "CallExpression") ||
          !isNodeOfType(node.callee, "Identifier") ||
          getRangeStart(node) !== hookPosition
        ) {
          return;
        }
        const bound = focal.scopes.symbolFor(node.callee);
        const local = bound?.declarationNode;
        const statement = bound && getImportDeclarationForSymbol(bound);
        if (
          statement?.source.value === importedSource &&
          isNodeOfType(local, "ImportSpecifier") &&
          isNodeOfType(local.imported, "Identifier") &&
          local.imported.name === importedHook
        ) {
          selected.push(node);
        }
      });
      if (selected.length !== 1) return null;

      const contextFiles = readReadonlyReactContextAsyncField({
        project: inspection,
        consumer: focal,
        hookCall: selected[0],
        field: pair.contextField,
      });
      if (!contextFiles) return null;
      testFile = caller.directNamedTestCandidates[0].filePath;
      return [
        ...new Set([inspection.appEntry, filename, caller.caller.filePath, ...contextFiles]),
      ].filter((file) => /\.[jt]sx$/u.test(file));
    },
  });
  if (!project || !testFile) return false;
  const named = readLoadingAsyncOwnershipJest({
    projectRoot,
    testFile,
    focalFile: filename,
    exportedName: name,
    openProperty: pair.openProperty,
    viewProperty: pair.viewProperty,
    focalImport: importedSource,
    hookExportName: importedHook,
    contextField: pair.contextField,
  });
  return Boolean(
    named &&
    named.renderer.react.entry === project.browser.react.entry &&
    named.renderer.client.entry === project.browser.renderer.entry &&
    hasNoOtherMountedLoadingTests({
      project,
      projectRoot,
      focalFile: filename,
      namedTestFile: testFile,
      jestReactEntry: named.renderer.react.entry,
    }),
  );
};
