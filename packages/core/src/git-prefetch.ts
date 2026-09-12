import { execFile } from "node:child_process";
import {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  GIT_SOURCE_LISTING_ARGUMENTS,
} from "./project-info/constants.js";
import type { GitCommandRequest } from "./types/index.js";

// Git commands a scan is certain to run (the source listing, the whole-repo
// cache identity) can start before the CLI bundle finishes evaluating; the
// consumer takes the pending output instead of spawning the same command
// again. Keyed by every spawn parameter so a request only matches an
// identical command in an identical directory.
const pendingOutputsByRequestKey = new Map<string, Promise<string | null>>();

const toRequestKey = (request: GitCommandRequest): string =>
  [request.directory, String(request.maxBufferBytes), ...request.args].join("\0");

export const runGitCommand = (request: GitCommandRequest): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      "git",
      [...request.args],
      { cwd: request.directory, encoding: "utf-8", maxBuffer: request.maxBufferBytes },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

export const prefetchGitCommand = (request: GitCommandRequest): void => {
  const requestKey = toRequestKey(request);
  if (pendingOutputsByRequestKey.has(requestKey)) return;
  pendingOutputsByRequestKey.set(requestKey, runGitCommand(request));
};

export const takePrefetchedGitCommand = (
  request: GitCommandRequest,
): Promise<string | null> | null => {
  const requestKey = toRequestKey(request);
  const pendingOutput = pendingOutputsByRequestKey.get(requestKey) ?? null;
  if (pendingOutput !== null) pendingOutputsByRequestKey.delete(requestKey);
  return pendingOutput;
};

export const discardPrefetchedGitCommands = (): void => {
  pendingOutputsByRequestKey.clear();
};

export const buildGitSourceListingRequest = (directory: string): GitCommandRequest => ({
  directory,
  args: GIT_SOURCE_LISTING_ARGUMENTS,
  maxBufferBytes: GIT_LS_FILES_MAX_BUFFER_BYTES,
});
