import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
const ENVIRONMENT_OVERRIDES = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "ESBUILD_BINARY_PATH",
  "ESBUILD_WORKER_THREADS",
  "npm_config_script_shell",
  "npm_config_node_options",
  "npm_config_prefix",
  "PREFIX",
]);
const hasStockEnvironment = (): boolean =>
  process.platform === "linux" &&
  process.arch === "x64" &&
  process.release.name === "node" &&
  !process.versions.bun &&
  !process.versions.electron &&
  process.versions.node.startsWith("24.") &&
  process.execArgv.length === 0 &&
  (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "production") &&
  Object.entries(process.env).every(
    ([key, value]) =>
      !value ||
      (!ENVIRONMENT_OVERRIDES.has(key) &&
        !ENVIRONMENT_OVERRIDES.has(key.toLowerCase()) &&
        !/^(?:ELECTRON_|VITE_|BABEL_)/u.test(key)),
  );

const isEmptyOrMissingConfig = (filename: string): boolean => {
  if (!path.isAbsolute(filename)) return false;
  const info = stat(filename);
  return !info || (info.isFile() && info.size === 0 && fs.realpathSync(filename) === filename);
};

const hasStockNpmConfiguration = (root: string): boolean => {
  // A selected npm config can change the build script shell. Inspect only
  // candidate file metadata because npm config may contain credentials.
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (!isEmptyOrMissingConfig(path.join(directory, ".npmrc"))) return false;
    if (path.dirname(directory) === directory) break;
  }
  const defaults = [
    ["npm_config_userconfig", path.join(homedir(), ".npmrc")],
    ["npm_config_globalconfig", path.resolve(path.dirname(process.execPath), "../etc/npmrc")],
  ] as const;
  for (const [variable, fallback] of defaults) {
    const configured = Object.entries(process.env)
      .filter(([key, value]) => key.toLowerCase() === variable && value)
      .map(([, value]) => value!);
    if (!(configured.length > 0 ? configured : [fallback]).every(isEmptyOrMissingConfig))
      return false;
  }
  return true;
};

const stockNodeShebang = (root: string): boolean => {
  // npm prepends ancestor node_modules/.bin directories before PATH. Refuse
  // their node shadows, then require the first ordinary PATH node to be the
  // same trusted runtime that is evaluating this proof.
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (stat(path.join(directory, "node_modules", ".bin", "node"))) return false;
    if (path.dirname(directory) === directory) break;
  }
  const runtime = fs.realpathSync(process.execPath);
  const npmRuntime = process.env.npm_node_execpath;
  if (npmRuntime && fs.realpathSync(npmRuntime) !== runtime) return false;
  const entries = process.env.PATH?.split(path.delimiter);
  if (!entries?.length) return false;
  for (const entry of entries) {
    if (!entry || !path.isAbsolute(entry)) return false;
    const candidate = path.join(entry, "node");
    if (!stat(candidate)) continue;
    const selected = fs.realpathSync(candidate);
    const target = stat(selected);
    return selected === runtime && Boolean(target?.isFile() && target.mode & 0o111);
  }
  return false;
};

export const hasStockNodeNpmCompilerEnvironment = (projectRoot: string): boolean => {
  if (!hasStockEnvironment()) return false;
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: unknown } }
    | undefined;
  return (
    typeof report?.header?.glibcVersionRuntime === "string" &&
    stockNodeShebang(projectRoot) &&
    hasStockNpmConfiguration(projectRoot)
  );
};

export const hasExpectedNpmLauncher = (launcher: string, relativeTarget: string): boolean => {
  if (fs.lstatSync(launcher, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return false;
  const target = path.resolve(path.dirname(launcher), relativeTarget);
  if (fs.readlinkSync(launcher) !== relativeTarget || fs.realpathSync(launcher) !== target)
    return false;
  const info = fs.lstatSync(target, { throwIfNoEntry: false });
  return info?.isFile() === true && (info.mode & 0o111) !== 0;
};
