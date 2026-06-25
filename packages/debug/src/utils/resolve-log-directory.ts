import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LOG_DIRECTORY_NAME, PROJECT_KEY_LENGTH } from "../constants.js";

// Server logs + the reuse lock live in the OS temp dir, never the repo. Each
// project gets its own subdirectory (keyed by a hash of the resolved project
// path, so no absolute path leaks into the tree) so two projects' `debug serve`
// runs don't share a lock and hand each other's endpoint/session back. Without a
// project directory it falls back to the shared base, preserving the old default.
export const resolveLogDirectory = (projectDirectory?: string): string => {
  const baseDirectory = path.join(os.tmpdir(), LOG_DIRECTORY_NAME);
  if (!projectDirectory) return baseDirectory;
  const projectKey = crypto
    .createHash("sha256")
    .update(path.resolve(projectDirectory))
    .digest("hex")
    .slice(0, PROJECT_KEY_LENGTH);
  return path.join(baseDirectory, projectKey);
};
