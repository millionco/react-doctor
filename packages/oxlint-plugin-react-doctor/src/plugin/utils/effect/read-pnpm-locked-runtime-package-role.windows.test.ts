import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  MARKED_RENDERER_INTEGRITY,
  MARKED_RENDERER_VERSION,
  PNPM_LOCK_ROLE_MAX_FILE_BYTES,
} from "./modern-source-scheduling-role/constants.js";
import {
  readPnpmLockedRuntimePackageRole,
  type PnpmRuntimeRoleProject,
} from "./read-pnpm-locked-runtime-package-role.js";

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(),
  manifests: new Map<string, unknown>(),
}));

vi.mock("node:path", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:path")>();
  return original.win32;
});

vi.mock("node:fs", () => ({
  lstatSync: (filename: string) => {
    const source = fixture.files.get(path.normalize(filename));
    return source === undefined
      ? undefined
      : {
          isFile: () => true,
          isSymbolicLink: () => false,
          size: Buffer.byteLength(source),
        };
  },
  readFileSync: (filename: string) => {
    const source = fixture.files.get(path.normalize(filename));
    if (source === undefined) throw new Error("Missing lock fixture");
    return source;
  },
}));

vi.mock("../read-nearest-package-manifest.js", () => ({
  readPackageManifest: (directory: string) => fixture.manifests.get(path.normalize(directory)),
}));

const lockSource = JSON.stringify({
  lockfileVersion: "9.0",
  importers: {
    ".": {
      dependencies: {
        marked: { specifier: `^${MARKED_RENDERER_VERSION}`, version: MARKED_RENDERER_VERSION },
      },
    },
  },
  packages: {
    [`marked@${MARKED_RENDERER_VERSION}`]: {
      resolution: { integrity: MARKED_RENDERER_INTEGRITY },
    },
  },
  snapshots: { [`marked@${MARKED_RENDERER_VERSION}`]: {} },
});

const addProject = (directory: string, source = lockSource): PnpmRuntimeRoleProject => {
  fixture.files.set(path.join(directory, "pnpm-lock.yaml"), source);
  fixture.manifests.set(path.normalize(directory), {
    packageManager: "pnpm@10.29.1",
    dependencies: { marked: `^${MARKED_RENDERER_VERSION}` },
  });
  return {
    packageDirectory: directory,
    lockDirectory: directory,
    hasDisjointOverrides: () => true,
  };
};

const readRole = (packageDirectory: string, projects: ReadonlyArray<PnpmRuntimeRoleProject>) =>
  readPnpmLockedRuntimePackageRole({
    packageDirectory,
    packageName: "marked",
    version: MARKED_RENDERER_VERSION,
    integrity: MARKED_RENDERER_INTEGRITY,
    catalogSpecifiers: new Map(),
    projects,
  });

beforeEach(() => {
  fixture.files.clear();
  fixture.manifests.clear();
});

describe("Windows locked runtime package identities", () => {
  it.each([
    ["C:\\workspace\\selected", "C:/workspace/selected"],
    ["C:/workspace/selected", "C:\\workspace\\selected"],
  ])("recognizes selected package %s against project %s", (selectedDirectory, projectDirectory) => {
    expect(readRole(selectedDirectory, [addProject(projectDirectory)])).toEqual({
      didFindLockfile: true,
      hasSupportedResolution: true,
      hasContradiction: false,
    });
  });

  it("does not select a foreign package with the same locked dependency", () => {
    expect(readRole("C:\\workspace\\selected", [addProject("C:/workspace/foreign")])).toEqual({
      didFindLockfile: false,
      hasSupportedResolution: false,
      hasContradiction: false,
    });
  });

  it("retains selected lock contradictions across filename spellings", () => {
    const project = addProject(
      "C:/workspace/selected",
      lockSource.replace(MARKED_RENDERER_INTEGRITY, "contradictory-integrity"),
    );
    expect(readRole("C:\\workspace\\selected", [project])).toEqual({
      didFindLockfile: true,
      hasSupportedResolution: false,
      hasContradiction: true,
    });
  });

  it("counts one shared lock once across native and canonical directories", () => {
    const paddedSource = lockSource.padEnd(PNPM_LOCK_ROLE_MAX_FILE_BYTES);
    const selected = addProject("C:/workspace/selected", paddedSource);
    const firstForeign = addProject("C:/workspace/foreign", paddedSource);
    const repeatedForeign = { ...firstForeign, lockDirectory: "C:\\workspace\\foreign" };
    expect(readRole("C:\\workspace\\selected", [firstForeign, repeatedForeign, selected])).toEqual({
      didFindLockfile: true,
      hasSupportedResolution: true,
      hasContradiction: false,
    });
  });

  it("keeps the aggregate byte limit for distinct locks", () => {
    const projects = ["first", "second", "selected"].map((name) =>
      addProject(`C:/workspace/${name}`, lockSource.padEnd(PNPM_LOCK_ROLE_MAX_FILE_BYTES)),
    );
    expect(readRole("C:\\workspace\\selected", projects)).toEqual({
      didFindLockfile: true,
      hasSupportedResolution: false,
      hasContradiction: true,
    });
  });
});
