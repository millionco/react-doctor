import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { hasBoundedDataModuleStartup } from "./has-bounded-data-module-startup.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

interface PhysicalDataModuleStartupInput {
  readonly workspaceRoot: string;
  readonly configFile: string;
  readonly requests: readonly string[];
}

const SOURCE_REQUEST = /^(?:\.\.?\/)+(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.m?js$/u;
const MAX_SELECTED_MODULES = 32;
const MAX_MODULE_BYTES = 64 * 1024;
const MAX_CLOSURE_BYTES = 256 * 1024;

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const isCanonical = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};

const resolveSource = (workspace: string, issuer: string, request: string): string | null => {
  if (!SOURCE_REQUEST.test(request)) return null;
  const selected = path.resolve(path.dirname(issuer), request);
  if (!isPathInside(selected, workspace) || selected === workspace) return null;
  const relative = path.relative(workspace, selected);
  return relative.split(path.sep).includes("node_modules") ? null : selected;
};

export const hasPhysicalDataModuleStartup = ({
  workspaceRoot,
  configFile,
  requests,
}: PhysicalDataModuleStartupInput): boolean => {
  if (
    !path.isAbsolute(workspaceRoot) ||
    path.resolve(workspaceRoot) !== workspaceRoot ||
    !path.isAbsolute(configFile) ||
    path.resolve(configFile) !== configFile ||
    !isPathInside(configFile, workspaceRoot) ||
    requests.length === 0
  )
    return false;
  try {
    if (
      !stat(workspaceRoot)?.isDirectory() ||
      !isCanonical(workspaceRoot) ||
      !stat(configFile)?.isFile() ||
      !isCanonical(configFile)
    )
      return false;
    const selected = requests.map((request) => resolveSource(workspaceRoot, configFile, request));
    if (selected.some((filename) => filename === null)) return false;
    const sourceByPath = new Map<string, string>();
    const entries: string[] = [];
    const pending: string[] = [];
    for (const filename of selected) {
      if (!filename) return false;
      pending.push(filename);
      entries.push(path.relative(workspaceRoot, filename));
    }
    let selectedBytes = 0;
    while (pending.length > 0) {
      const filename = pending.pop()!;
      const logicalPath = path.relative(workspaceRoot, filename);
      if (sourceByPath.has(logicalPath)) continue;
      if (sourceByPath.size >= MAX_SELECTED_MODULES) return false;
      const info = stat(filename);
      if (
        !info?.isFile() ||
        info.nlink !== 1 ||
        info.size > MAX_MODULE_BYTES ||
        selectedBytes + info.size > MAX_CLOSURE_BYTES ||
        !isCanonical(filename)
      )
        return false;
      const bytes = readProviderMember(filename);
      if (!bytes || bytes.length !== info.size) return false;
      selectedBytes += bytes.length;
      const source = bytes.toString("utf8");
      const program = parseSourceText({
        filename,
        sourceText: source,
        language: "js",
        shouldAttachParentReferences: false,
      });
      if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
      sourceByPath.set(logicalPath, source);
      for (const statement of program.body) {
        if (
          (!isNodeOfType(statement, "ImportDeclaration") &&
            !isNodeOfType(statement, "ExportAllDeclaration") &&
            !isNodeOfType(statement, "ExportNamedDeclaration")) ||
          !statement.source
        )
          continue;
        if (typeof statement.source.value !== "string") return false;
        const dependency = statement.source.value;
        if (!dependency.startsWith(".")) continue;
        const imported = resolveSource(workspaceRoot, filename, dependency);
        if (!imported) return false;
        pending.push(imported);
      }
    }
    return hasBoundedDataModuleStartup({ entries, sourceByPath });
  } catch {
    return false;
  }
};
