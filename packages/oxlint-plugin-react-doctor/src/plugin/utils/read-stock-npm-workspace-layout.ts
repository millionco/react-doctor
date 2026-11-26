import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

export interface StockNpmWorkspaceLayout {
  readonly moduleRoots: readonly string[];
  // The known profile binds every link slot and its in-root workspace path.
  readonly workspaceLinks: Readonly<Record<string, string>>;
}

const PACKAGE_SEGMENT = "[a-z0-9][a-z0-9._-]*";
const WORKSPACE = /^(?:[a-zA-Z0-9_][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9_][a-zA-Z0-9._-]*$/u;
const SLOT = new RegExp(`^node_modules/((?:@${PACKAGE_SEGMENT}/)?${PACKAGE_SEGMENT})$`, "u");

const isPhysicalDirectory = (candidate: string): boolean => {
  recordExistenceProbe(candidate);
  recordRealpathProbe(candidate);
  return (
    fs.lstatSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true &&
    fs.realpathSync(candidate) === candidate
  );
};

export const readStockNpmWorkspaceLayout = (
  root: string,
  layout: StockNpmWorkspaceLayout,
): {
  readonly links: ReadonlySet<string>;
  readonly moduleDirectories: readonly string[];
} | null => {
  try {
    const bytes = readProviderMember(path.join(root, "package.json"));
    if (!bytes || bytes.length > 64 * 1024) return null;
    const { workspaces } = JSON.parse(bytes.toString("utf8"));
    if (
      !Array.isArray(workspaces) ||
      workspaces.some(
        (value) => typeof value !== "string" || !WORKSPACE.test(value.replace(/\/\*$/u, "")),
      )
    )
      return null;
    const links = new Set<string>();
    const targets = new Set<string>();
    for (const [slot, target] of Object.entries(layout.workspaceLinks)) {
      const name = SLOT.exec(slot)?.[1];
      if (
        !name ||
        !WORKSPACE.test(target) ||
        targets.has(target) ||
        !workspaces.some(
          (declaration: string) =>
            declaration === target || declaration === path.dirname(target) + "/*",
        )
      )
        return null;
      const lexical = path.join(root, slot);
      const physicalTarget = path.join(root, target);
      if (!isPhysicalDirectory(physicalTarget) || !isPhysicalDirectory(path.dirname(lexical)))
        return null;
      const member = readProviderMember(path.join(physicalTarget, "package.json"));
      if (
        !member ||
        member.length > 64 * 1024 ||
        JSON.parse(member.toString("utf8")).name !== name
      ) {
        return null;
      }
      recordExistenceProbe(lexical);
      recordRealpathProbe(lexical);
      const stat = fs.lstatSync(lexical, { bigint: true, throwIfNoEntry: false });
      if (!stat?.isSymbolicLink()) return null;
      const expected = path.relative(path.dirname(lexical), physicalTarget);
      if (fs.readlinkSync(lexical) !== expected || fs.realpathSync(lexical) !== physicalTarget)
        return null;
      const after = fs.lstatSync(lexical, { bigint: true });
      if (after.dev !== stat.dev || after.ino !== stat.ino || after.ctimeNs !== stat.ctimeNs)
        return null;
      links.add(lexical);
      targets.add(target);
    }
    const localRoots = layout.moduleRoots;
    if (
      !localRoots.includes("node_modules") ||
      localRoots.length !== new Set(localRoots).size ||
      localRoots.some(
        (name) =>
          name !== "node_modules" &&
          (path.basename(name) !== "node_modules" || !targets.has(path.dirname(name))),
      )
    )
      return null;
    const moduleDirectories = localRoots.map((item) => path.join(root, item));
    if (!moduleDirectories.every(isPhysicalDirectory)) return null;
    for (const workspace of targets) {
      const candidate = path.join(root, workspace, "node_modules");
      recordExistenceProbe(candidate);
      if (
        !moduleDirectories.includes(candidate) &&
        fs.lstatSync(candidate, { throwIfNoEntry: false })
      ) {
        return null;
      }
    }
    return { links, moduleDirectories };
  } catch {
    return null;
  }
};
