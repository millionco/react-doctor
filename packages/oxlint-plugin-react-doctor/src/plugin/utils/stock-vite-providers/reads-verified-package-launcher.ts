import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";
import { readProviderMember } from "./resolve-stock-physical-entry.js";
import stockLauncher from "./stock-pnpm-launcher-template.json" with { type: "json" };

interface LauncherLocation {
  readonly projectRoot: string;
  readonly projectDirectory: string;
  readonly packageDirectory: string;
}

interface NpmLauncherInput extends LauncherLocation {
  readonly binary: "vite" | "jest";
  readonly pnpm?: never;
}

interface PnpmLauncherInput extends LauncherLocation {
  readonly binary: string;
  readonly pnpm: {
    readonly packageName: string;
    readonly entry: string;
    readonly virtualStore: string;
    readonly native?: boolean;
  };
}

const recordPath = (target: string): void => {
  recordExistenceProbe(target);
  recordRealpathProbe(target);
};

const shellData = (value: string): boolean => /^[a-zA-Z0-9_@+.,:()/-]+$/u.test(value);
const binaryName = /^[A-Za-z0-9_-]+$/u;

export const readsVerifiedPackageLauncher = (
  input: NpmLauncherInput | PnpmLauncherInput,
): boolean => {
  try {
    const { projectRoot, projectDirectory, packageDirectory, binary } = input;
    const modules = path.join(projectDirectory, "node_modules");
    const localBin = path.join(modules, ".bin");
    const filename = path.join(localBin, binary);
    const entry = input.pnpm?.entry ?? path.join(packageDirectory, "bin", binary + ".js");
    if (
      !binaryName.test(binary) ||
      !isPathInside(projectDirectory, projectRoot) ||
      !isPathInside(packageDirectory, projectRoot) ||
      !isPathInside(entry, packageDirectory)
    )
      return false;
    recordPath(filename);
    recordPath(entry);
    if (fs.realpathSync(entry) !== entry) return false;

    const friendNode = path.join(localBin, "node");
    recordExistenceProbe(friendNode);
    if (fs.existsSync(friendNode)) return false;
    const launcherStat = fs.lstatSync(filename);
    if (launcherStat.isSymbolicLink()) {
      return fs.realpathSync(filename) === entry && (fs.statSync(entry).mode & 0o111) !== 0;
    }
    if (!launcherStat.isFile() || launcherStat.size > 16_384 || (launcherStat.mode & 0o111) === 0)
      return false;

    const virtualStore = input.pnpm?.virtualStore ?? path.join(modules, ".pnpm");
    const packageName = input.pnpm?.packageName ?? binary;
    const relative = path.relative(virtualStore, packageDirectory).split(path.sep);
    if (
      !isPathInside(virtualStore, projectRoot) ||
      !isPathInside(packageDirectory, virtualStore) ||
      relative[1] !== "node_modules" ||
      relative.slice(2).join("/") !== packageName
    )
      return false;
    const packageLookupDirectory = path.join(virtualStore, relative[0]!, "node_modules");
    const moduleDirectories: string[] = [];
    for (
      let directory = path.dirname(entry);
      directory !== packageLookupDirectory;
      directory = path.dirname(directory)
    ) {
      if (!isPathInside(directory, packageLookupDirectory)) return false;
      moduleDirectories.push(path.join(directory, "node_modules"));
    }
    moduleDirectories.push(packageLookupDirectory, path.join(virtualStore, "node_modules"));
    const moduleSearchPath = moduleDirectories.join(":");
    const body = readProviderMember(filename)?.toString("utf8");
    const matchesLauncher = (selectedEntry: string): boolean => {
      const relativeEntry = path.relative(localBin, selectedEntry).split(path.sep).join("/");
      if (!shellData(moduleSearchPath) || !shellData(relativeEntry)) return false;
      const template =
        input.pnpm?.native === true
          ? stockLauncher.template.slice(
              0,
              stockLauncher.template.indexOf('if [ -x "$basedir/node" ]'),
            ) + '"{{localEntrypoint}}"   "$@"\nexit $?\n'
          : stockLauncher.template;
      const expected = template
        .replaceAll("{{moduleSearchPath}}", moduleSearchPath)
        .replaceAll("{{localEntrypoint}}", "$basedir/" + relativeEntry);
      return body === expected;
    };
    if (matchesLauncher(entry)) return true;
    if (!input.pnpm) return false;
    const linkedEntry = path.join(modules, packageName, path.relative(packageDirectory, entry));
    recordPath(linkedEntry);
    return matchesLauncher(linkedEntry) && fs.realpathSync(linkedEntry) === entry;
  } catch {
    return false;
  }
};
