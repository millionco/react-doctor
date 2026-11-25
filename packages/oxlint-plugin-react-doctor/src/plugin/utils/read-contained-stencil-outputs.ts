import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";

export interface StencilOutputPath {
  readonly absolutePath: string;
  readonly kind: "file" | "directory";
  readonly role: "generated-config" | "component-types" | "builtin" | "proxy";
}
interface StencilOutputBoundary {
  readonly workspaceRoot: string;
  readonly projectDirectory: string;
  readonly outputs: readonly StencilOutputPath[];
  readonly protectedInputs: readonly string[];
}

const maxInspectedEntries = 20_000;

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const canonical = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};

const ordinaryOutput = (
  filename: string,
  info: fs.Stats,
  kind: StencilOutputPath["kind"],
): boolean =>
  !info.isSymbolicLink() &&
  canonical(filename) &&
  (kind === "directory" ? info.isDirectory() : info.isFile() && info.nlink === 1);

export const readContainedStencilOutputPaths = (boundary: StencilOutputBoundary) => {
  const { workspaceRoot: root, projectDirectory: owner, outputs, protectedInputs } = boundary;
  const sourceRoot = path.join(owner, "src");
  const declaration = path.join(sourceRoot, "components.d.ts");
  try {
    if (
      !path.isAbsolute(root) ||
      !path.isAbsolute(owner) ||
      !isPathInside(owner, root) ||
      !stat(root)?.isDirectory() ||
      !canonical(root) ||
      !stat(owner)?.isDirectory() ||
      !canonical(owner) ||
      outputs.length === 0 ||
      outputs.length > 64
    )
      return null;
    const protectedPaths = [
      sourceRoot,
      path.join(owner, "scripts"),
      path.join(owner, "package.json"),
      ...protectedInputs,
    ];
    if (protectedPaths.some((input) => !path.isAbsolute(input) || !isPathInside(input, root)))
      return null;
    const checkedDestinations: string[] = [];
    let inspectedEntries = 0;
    for (const { absolutePath: target, kind, role } of outputs) {
      if (
        !path.isAbsolute(target) ||
        path.normalize(target) !== target ||
        target === root ||
        target === owner ||
        !isPathInside(target, root) ||
        path.relative(root, target).split(path.sep).includes("node_modules")
      )
        return null;
      if (role === "proxy" && kind !== "file") return null;
      if (role !== "proxy" && !isPathInside(target, owner)) return null;
      if (
        role === "generated-config" &&
        (kind !== "file" || target !== path.join(owner, "stencil.config.js"))
      )
        return null;
      const managesDeclarations =
        role === "component-types" && kind === "file" && target === declaration;
      if (role === "component-types" && !managesDeclarations) return null;
      if (
        protectedPaths.some((input) => {
          if (managesDeclarations && input === sourceRoot) return false;
          return (
            isPathInside(target, input) || (kind === "directory" && isPathInside(input, target))
          );
        })
      )
        return null;

      for (let current = target; ; current = path.dirname(current)) {
        const info = stat(current);
        if (info && !ordinaryOutput(current, info, current === target ? kind : "directory"))
          return null;
        if (current === root) break;
      }
      if (kind === "directory" && stat(target)) {
        const pending = [target];
        while (pending.length) {
          const directory = pending.pop()!;
          recordDirectoryProbe(directory);
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (++inspectedEntries > maxInspectedEntries) return null;
            const member = path.join(directory, entry.name);
            const info = stat(member);
            if (!info || !ordinaryOutput(member, info, info.isDirectory() ? "directory" : "file"))
              return null;
            if (info.isDirectory()) pending.push(member);
          }
        }
      }
      checkedDestinations.push(target);
    }
    return { checkedDestinations };
  } catch {
    return null;
  }
};
