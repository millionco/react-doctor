import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  buildGitSourceListingRequest,
  discardPrefetchedGitCommands,
  prefetchGitCommand,
  runGitCommand,
  takePrefetchedGitCommand,
} from "../src/git-prefetch.js";
import { GIT_LS_FILES_MAX_BUFFER_BYTES } from "../src/project-info/constants.js";
import { listSourceFilesWithSizeCooperative } from "../src/utils/list-source-files.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-git-prefetch-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const createRepository = (name: string): string => {
  const repositoryDirectory = path.join(temporaryRoot, name);
  fs.mkdirSync(path.join(repositoryDirectory, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryDirectory, "src", "App.tsx"),
    "export const App = () => null;\n",
  );
  fs.writeFileSync(path.join(repositoryDirectory, "notes.md"), "# notes\n");
  execFileSync("git", ["init", "-q"], { cwd: repositoryDirectory });
  return repositoryDirectory;
};

describe("git command prefetch", () => {
  it("hands a prefetched command to the first matching take and then forgets it", async () => {
    const repositoryDirectory = createRepository("take-once");
    const request = buildGitSourceListingRequest(repositoryDirectory);
    prefetchGitCommand(request);
    const pendingOutput = takePrefetchedGitCommand(request);
    expect(pendingOutput).not.toBeNull();
    expect(takePrefetchedGitCommand(request)).toBeNull();
    expect(await pendingOutput).toBe(await runGitCommand(request));
  });

  it("keys on every spawn parameter", () => {
    const repositoryDirectory = createRepository("keyed");
    const request = buildGitSourceListingRequest(repositoryDirectory);
    prefetchGitCommand(request);
    expect(takePrefetchedGitCommand({ ...request, directory: temporaryRoot })).toBeNull();
    expect(takePrefetchedGitCommand({ ...request, args: ["ls-files"] })).toBeNull();
    expect(takePrefetchedGitCommand({ ...request, maxBufferBytes: 1 })).toBeNull();
    expect(takePrefetchedGitCommand(request)).not.toBeNull();
  });

  it("resolves a failed command to null like a direct spawn", async () => {
    const request = {
      directory: path.join(temporaryRoot, "missing-directory"),
      args: ["rev-parse", "HEAD"],
      maxBufferBytes: GIT_LS_FILES_MAX_BUFFER_BYTES,
    };
    prefetchGitCommand(request);
    expect(await takePrefetchedGitCommand(request)).toBeNull();
  });

  it("discards every pending command", () => {
    const repositoryDirectory = createRepository("discarded");
    const request = buildGitSourceListingRequest(repositoryDirectory);
    prefetchGitCommand(request);
    discardPrefetchedGitCommands();
    expect(takePrefetchedGitCommand(request)).toBeNull();
  });

  it("lists the same source files from a prefetched listing as from a fresh one", async () => {
    const repositoryDirectory = createRepository("listing");
    const freshEntries = await listSourceFilesWithSizeCooperative(repositoryDirectory);
    prefetchGitCommand(buildGitSourceListingRequest(repositoryDirectory));
    const prefetchedEntries = await listSourceFilesWithSizeCooperative(repositoryDirectory);
    expect(prefetchedEntries).toEqual(freshEntries);
    expect(prefetchedEntries.map((entry) => entry.path)).toEqual(["src/App.tsx"]);
  });
});
