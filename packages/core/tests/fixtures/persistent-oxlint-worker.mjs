import { createRequire } from "node:module";
import * as path from "node:path";
import * as readline from "node:readline";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const oxlintDirectory = path.dirname(require.resolve("oxlint"));
const bindings = await import(pathToFileURL(path.join(oxlintDirectory, "bindings.js")).href);
const lintModule = await import(pathToFileURL(path.join(oxlintDirectory, "lint.js")).href);
let pluginModule;
let workspaceModule;
let jsConfigModule;

const loadPluginModule = async () => {
  pluginModule ??= await import(pathToFileURL(path.join(oxlintDirectory, "plugins.js")).href);
  return pluginModule;
};

const loadWorkspaceModule = async () => {
  workspaceModule ??= await import(pathToFileURL(path.join(oxlintDirectory, "workspace.js")).href);
  return workspaceModule;
};

const loadPlugin = async (...argumentsList) =>
  (await loadPluginModule()).loadPlugin(...argumentsList);
const setupRuleConfigs = (...argumentsList) => pluginModule.setupRuleConfigs(...argumentsList);
const lintFile = (...argumentsList) => pluginModule.lintFile(...argumentsList);
const createWorkspace = async (workspaceUri) =>
  (await loadWorkspaceModule()).createWorkspace(workspaceUri);
const destroyWorkspace = (workspaceUri) => workspaceModule.destroyWorkspace(workspaceUri);
const loadJsConfigs = async (paths) => {
  jsConfigModule ??= await import(pathToFileURL(path.join(oxlintDirectory, "js_config.js")).href);
  return process.env.VP_VERSION
    ? jsConfigModule.loadVitePlusConfigs(paths)
    : jsConfigModule.loadJsConfigs(paths);
};

const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  process.chdir(request.rootDirectory);
  try {
    // This fixture deliberately pins Oxlint's private process-global rule table reset.
    // Production code must not depend on this ABI until Oxlint exposes a supported API.
    lintModule.s.length = 0;
    await bindings.r(
      request.args.slice(1),
      loadPlugin,
      setupRuleConfigs,
      lintFile,
      createWorkspace,
      destroyWorkspace,
      loadJsConfigs,
    );
    process.stdout.write(`${request.responseMarker}\u0001\n`);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.stdout.write(`${request.responseMarker}\u0000\n`);
  }
}
