import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import type { StockNpmCompilerProfile } from "./verify-stock-npm-compiler-packages.js";
import { readVerifiedVite5ReactTailwindProviders } from "./read-verified-vite5-react-tailwind-providers.js";
export interface FlatNpmWorkspaceViteBuild {
  readonly workspaceDirectory: string;
  readonly projectDirectory: string;
  readonly declaredCommand: readonly ["npm", "--workspace", string, "run", "build"];
  readonly configFile: string;
  readonly viteEntry: string;
  readonly viteLauncher: string;
  readonly npmDispatcherVerified: boolean;
}
const stat = (f: string) => {
  recordExistenceProbe(f);
  return fs.lstatSync(f, { throwIfNoEntry: false });
};
const canonical = (f: string) => {
  recordRealpathProbe(f);
  return fs.realpathSync(f) === f;
};
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const metadata = (dir: string) => {
  const f = path.join(dir, "package.json"),
    s = stat(f);
  if (!s?.isFile() || s.nlink !== 1 || s.size > 65536 || !canonical(f)) return null;
  const b = readProviderMember(f);
  return b ? object(JSON.parse(b.toString("utf8"))) : null;
};
const noOverrideMetadata = (m: Record<string, unknown>) =>
  ![
    "overrides",
    "resolutions",
    "pnpm",
    "config",
    "vite",
    "babel",
    "build",
    "imports",
    "browser",
  ].some((k) => Object.hasOwn(m, k));
const simpleRelative = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u;
const safeNpmEnvironment = new Set([
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "npm_config_user_agent",
  "npm_config_offline",
  "npm_config_manage_package_manager_versions",
]);
const alternateConfigs = [
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.json",
];
/** Ordinary toolchain inference, matching the existing Node/npm environment premise.
 * Selects the same physical npm CLI as the trusted running Node installation; this is
 * not a reconstruction or content attestation of a historical npm installation. */
function hasNormalNpmWorkspaceDispatch(workspace: string, project: string): boolean {
  try {
    if (!hasStockNodeNpmCompilerEnvironment(project)) return false;
    const installed = path.join(path.dirname(process.execPath), "npm");
    recordRealpathProbe(installed);
    if (!stat(installed)) return false;
    const trustedCli = fs.realpathSync(installed);
    if (!trustedCli.endsWith("/node_modules/npm/bin/npm-cli.js") || !stat(trustedCli)?.isFile())
      return false;
    const active = process.env.npm_execpath;
    if (active) {
      if (!path.isAbsolute(active)) return false;
      recordRealpathProbe(active);
      if (fs.realpathSync(active) !== trustedCli) return false;
    }
    const bins: string[] = [];
    for (let d = project; ; d = path.dirname(d)) {
      bins.push(path.join(d, "node_modules/.bin"));
      if (d === workspace) break;
      if (!d.startsWith(workspace + path.sep)) return false;
    }
    const inherited = process.env.PATH?.split(path.delimiter);
    if (!inherited?.length || inherited.some((x) => !x || !path.isAbsolute(x))) return false;
    for (const d of [...bins, ...inherited]) {
      const candidate = path.join(d, "npm");
      if (!stat(candidate)) continue;
      recordRealpathProbe(candidate);
      return fs.realpathSync(candidate) === trustedCli;
    }
    return false;
  } catch {
    return false;
  }
}

/** Declaration and physical-provider preflight. Compiler config AST/body must be separately qualified. */
export function readFlatNpmWorkspaceViteBuild(
  workspace: string,
  project: string,
  profile: StockNpmCompilerProfile,
): FlatNpmWorkspaceViteBuild | null {
  try {
    if (
      ![workspace, project].every(
        (f) => path.isAbsolute(f) && path.normalize(f) === f && canonical(f),
      ) ||
      !project.startsWith(workspace + path.sep)
    )
      return null;
    const relative = path.relative(workspace, project).split(path.sep).join("/");
    if (!simpleRelative.test(relative)) return null;
    const root = metadata(workspace),
      app = metadata(project);
    if (!root || !app || !noOverrideMetadata(root) || !noOverrideMetadata(app)) return null;
    const workspaces = root.workspaces;
    if (
      !Array.isArray(workspaces) ||
      !workspaces.length ||
      workspaces.length > 16 ||
      new Set(workspaces).size !== workspaces.length ||
      !workspaces.every((x) => typeof x === "string" && simpleRelative.test(x)) ||
      !workspaces.includes(relative)
    )
      return null;
    const names = new Set<string>();
    for (const member of workspaces) {
      const memberDirectory = path.join(workspace, member as string);
      if (!canonical(memberDirectory)) return null;
      const memberMetadata = metadata(memberDirectory);
      if (
        !memberMetadata ||
        typeof memberMetadata.name !== "string" ||
        names.has(memberMetadata.name)
      )
        return null;
      names.add(memberMetadata.name);
      if (
        member !== relative &&
        (memberMetadata.name === relative || (member as string).startsWith(relative + "/"))
      )
        return null;
    }
    const rootScripts = object(root.scripts),
      appScripts = object(app.scripts);
    if (
      !rootScripts ||
      !appScripts ||
      rootScripts.build !== `npm --workspace ${relative} run build` ||
      appScripts.build !== "vite build" ||
      [rootScripts, appScripts].some((s) =>
        ["prebuild", "postbuild", "env"].some((n) => Object.hasOwn(s, n)),
      )
    )
      return null;
    if (
      !hasStockNodeNpmCompilerEnvironment(project) ||
      Object.entries(process.env).some(
        ([k, v]) =>
          v &&
          (/^(?:NAPI_RS_|ESBUILD_|VITE_|BABEL_|ROLLUP_|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|IFS$|CDPATH$|SHELLOPTS$|BASHOPTS$)/u.test(
            k,
          ) ||
            (/^npm_config_/iu.test(k) && !safeNpmEnvironment.has(k.toLowerCase()))),
      )
    )
      return null;
    for (const d of [workspace, project]) {
      for (const n of [
        ".env",
        ".env.local",
        ".env.production",
        ".env.production.local",
        ".babelrc",
        ".babelrc.js",
        ".babelrc.json",
        "babel.config.js",
        "babel.config.cjs",
        "babel.config.mjs",
      ])
        if (stat(path.join(d, n))) return null;
      for (const n of alternateConfigs) if (stat(path.join(d, n))) return null;
    }
    if (stat(path.join(workspace, "vite.config.js"))) return null;
    const configFile = path.join(project, "vite.config.js"),
      config = stat(configFile);
    if (!config?.isFile() || config.nlink !== 1 || !canonical(configFile)) return null;
    // npm-run PATH contains every ancestor .bin before the inherited PATH. Only the workspace winner is supported.
    for (let d = project; d !== workspace; d = path.dirname(d)) {
      if (!d.startsWith(workspace + path.sep)) return null;
      for (const command of ["vite", "npm", "node"])
        if (stat(path.join(d, "node_modules/.bin", command))) return null;
    }
    const viteLauncher = path.join(workspace, "node_modules/.bin/vite");
    if (!hasExpectedNpmLauncher(viteLauncher, "../vite/bin/vite.js")) return null;
    const providers = readVerifiedVite5ReactTailwindProviders(workspace, project, profile);
    if (!providers) return null;
    const viteEntry = providers.get("vite");
    if (!viteEntry) return null;
    const command = ["npm", "--workspace", relative, "run", "build"] as const;
    return {
      workspaceDirectory: workspace,
      projectDirectory: project,
      declaredCommand: command,
      configFile,
      viteEntry,
      viteLauncher,
      npmDispatcherVerified: hasNormalNpmWorkspaceDispatch(workspace, project),
    };
  } catch {
    return null;
  }
}
