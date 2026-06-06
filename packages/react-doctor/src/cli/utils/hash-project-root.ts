import { createHash } from "node:crypto";
import * as path from "node:path";

// Stable per-repo key for the shared global config store: hashes the resolved
// project root so absolute paths never land in the config file. Shared by the
// per-repo prompt-state modules (setup prompt, action upgrade).
export const hashProjectRoot = (projectRoot: string): string =>
  createHash("sha256").update(path.resolve(projectRoot)).digest("hex");
