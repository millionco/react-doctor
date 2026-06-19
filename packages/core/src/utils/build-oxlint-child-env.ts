import os from "node:os";
import * as path from "node:path";
import { NODE_COMPILE_CACHE_DIR_NAME } from "../constants.js";

// Keep oxlint children deterministic while sharing the V8 compile-cache base.
// Node namespaces entries by version under this directory, which keeps the nvm
// fallback path safe when the child runs a different Node binary.
export const buildOxlintChildEnv = (sourceEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    childEnv[name] = value;
  }

  const isCompileCacheDisabled = Boolean(sourceEnv.NODE_DISABLE_COMPILE_CACHE);
  if (isCompileCacheDisabled) {
    delete childEnv.NODE_COMPILE_CACHE;
    return childEnv;
  }

  if (!childEnv.NODE_COMPILE_CACHE) {
    childEnv.NODE_COMPILE_CACHE = path.join(os.tmpdir(), NODE_COMPILE_CACHE_DIR_NAME);
  }

  return childEnv;
};
