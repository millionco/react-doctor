import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";
import stockLauncher from "./stock-pnpm-launcher-template.json" with { type: "json" };

interface PackageLauncherInput {
  readonly projectRoot: string;
  readonly projectDirectory: string;
  readonly packageDirectory: string;
  readonly binary: "vite" | "jest";
}

const recordPath = (target: string): void => {
  recordExistenceProbe(target);
  recordRealpathProbe(target);
};

const shellData = (value: string): boolean => /^[a-zA-Z0-9_@+.,:()/-]+$/u.test(value);

export const readsVerifiedPackageLauncher = (input: PackageLauncherInput): boolean => {
  try {
    const { projectRoot, projectDirectory, packageDirectory, binary } = input;
    if (
      !isPathInside(projectDirectory, projectRoot) ||
      !isPathInside(packageDirectory, projectRoot)
    ) {
      return false;
    }
    const modules = path.join(projectDirectory, "node_modules");
    const filename = path.join(modules, ".bin", binary);
    const entry = path.join(packageDirectory, "bin", binary + ".js");
    recordPath(filename);
    recordPath(entry);
    if (fs.realpathSync(entry) !== entry) return false;

    const friendNode = path.join(modules, ".bin", "node");
    recordExistenceProbe(friendNode);
    if (fs.existsSync(friendNode)) return false;
    const launcherStat = fs.lstatSync(filename);
    if (launcherStat.isSymbolicLink()) {
      return fs.realpathSync(filename) === entry && (fs.statSync(entry).mode & 0o111) !== 0;
    }
    if (
      !launcherStat.isFile() ||
      launcherStat.size > 16_384 ||
      fs.realpathSync(filename) !== filename
    )
      return false;
    if ((launcherStat.mode & 0o111) === 0) return false;

    const pnpm = path.join(modules, ".pnpm");
    const packageLookupDirectory = path.dirname(packageDirectory);
    const relative = path.relative(pnpm, packageDirectory).split(path.sep);
    if (
      !isPathInside(packageDirectory, pnpm) ||
      relative.length !== 3 ||
      relative[1] !== "node_modules" ||
      relative[2] !== binary
    )
      return false;

    const moduleDirectories = [
      path.join(path.dirname(entry), "node_modules"),
      path.join(packageDirectory, "node_modules"),
      packageLookupDirectory,
      path.join(pnpm, "node_modules"),
    ];
    const moduleSearchPath = moduleDirectories.join(":");
    const relativeEntry = path.relative(modules, entry);
    if (!shellData(moduleSearchPath) || !shellData(relativeEntry)) return false;
    const renderLauncher = (entryPath: string): string =>
      stockLauncher.template
        .replaceAll("{{moduleSearchPath}}", moduleSearchPath)
        .replaceAll("{{localEntrypoint}}", "$basedir/../" + entryPath);
    recordContentProbe(filename);
    const content = fs.readFileSync(filename, "utf8");
    if (content === renderLauncher(relativeEntry)) return true;

    const linkedPackage = path.join(modules, binary);
    const linkedEntry = path.join(linkedPackage, "bin", binary + ".js");
    const linkedRelativeEntry = path.posix.join(binary, "bin", binary + ".js");
    if (content !== renderLauncher(linkedRelativeEntry)) return false;
    recordPath(linkedPackage);
    recordPath(linkedEntry);
    return (
      fs.realpathSync(linkedPackage) === packageDirectory && fs.realpathSync(linkedEntry) === entry
    );
  } catch {
    return false;
  }
};
