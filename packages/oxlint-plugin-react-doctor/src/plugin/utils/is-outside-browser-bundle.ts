import type { EsTreeNode } from "./es-tree-node.js";
import { isInsideNodeCliPackage } from "./is-inside-node-cli-package.js";
import { isNodeTargetedModule } from "./is-node-targeted-module.js";
import { moduleReferencesReact } from "./module-references-react.js";

// Node-only modules (builtin imports, CJS authoring, process API use) and
// non-React files inside bin-bearing packages (gatsby's build internals, a
// CLI's server code) never reach a browser bundle, so "ships in the main
// bundle" claims cannot apply to them. Only the React-rendering files of a
// bin-bearing package reach a browser.
export const isOutsideBrowserBundle = (node: EsTreeNode, filename: string | undefined): boolean =>
  isNodeTargetedModule(node) || (isInsideNodeCliPackage(filename) && !moduleReferencesReact(node));
