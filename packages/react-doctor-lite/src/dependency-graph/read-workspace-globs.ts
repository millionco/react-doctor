import * as fs from "node:fs";
import * as path from "node:path";
import type { DependencyManifest } from "../types.js";

// Pulls the `packages:` entries out of a `pnpm-workspace.yaml` with a
// deliberately tiny line scanner — the PoC avoids a YAML dependency. Handles
// the canonical `packages:` block of `- "glob"` items and stops at the next
// top-level key.
const readPnpmWorkspaceGlobs = (rootDirectory: string): string[] => {
  const workspaceFilePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  let raw: string;
  try {
    raw = fs.readFileSync(workspaceFilePath, "utf8");
  } catch {
    return [];
  }

  const globs: string[] = [];
  let insidePackagesBlock = false;
  for (const line of raw.split("\n")) {
    if (/^packages\s*:/.test(line)) {
      insidePackagesBlock = true;
      continue;
    }
    if (!insidePackagesBlock) continue;
    const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (itemMatch) {
      globs.push(itemMatch[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    // A non-indented, non-list line ends the block.
    if (/^\S/.test(line)) break;
  }
  return globs;
};

const readManifestWorkspaceGlobs = (manifest: DependencyManifest | null): string[] => {
  if (!manifest?.workspaces) return [];
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return manifest.workspaces.packages ?? [];
};

// Resolves the workspace globs for a monorepo root, preferring
// `pnpm-workspace.yaml` over the `package.json#workspaces` field.
export const readWorkspaceGlobs = (
  rootDirectory: string,
  manifest: DependencyManifest | null,
): string[] => {
  const pnpmGlobs = readPnpmWorkspaceGlobs(rootDirectory);
  if (pnpmGlobs.length > 0) return pnpmGlobs;
  return readManifestWorkspaceGlobs(manifest);
};
