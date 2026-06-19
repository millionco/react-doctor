import os from "node:os";
import * as path from "node:path";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../constants.js";

// Sanitize the child env so a developer's NODE_OPTIONS=--inspect (or
// --max-old-space-size=128, etc.) doesn't leak into oxlint and either spawn a
// debugger port or starve it of memory; drop npm_config_* lifecycle vars so
// oxlint can't pick up package-manager state. PATH, HOME, NODE_ENV, NODE_PATH
// pass through unchanged.
//
// oxlint batches are fresh `node` children that re-parse oxlint + plugin JS
// per spawn. The bin enables the V8 compile cache for the parent only, so
// propagate NODE_COMPILE_CACHE to the children that do the repeated work.
// Set the shared BASE dir (not the parent's version-specific getCompileCacheDir),
// because the child may run a different node (the nvm fallback in
// resolveNodeForOxlint): Node nests each node version under its own subdir of
// the base, so there is no cross-version cache poisoning, and a same-version
// child transparently reads what the parent warmed.
export const buildOxlintChildEnv = (sourceEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    childEnv[name] = value;
  }

  const isCompileCacheDisabled = Boolean(sourceEnv.NODE_DISABLE_COMPILE_CACHE);
  const isCompileCacheAlreadySet = childEnv.NODE_COMPILE_CACHE !== undefined;
  if (!isCompileCacheDisabled && !isCompileCacheAlreadySet) {
    childEnv.NODE_COMPILE_CACHE = path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME);
  }

  return childEnv;
};
