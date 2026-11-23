import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";
import { classifyExistenceAnswer } from "../../utils/classify-existence-answer.js";
import { hashFileContents } from "../../utils/hash-file-contents.js";
import { isErrnoException } from "../../utils/is-errno-exception.js";
import { readRealpathIdentity } from "../../utils/read-realpath-identity.js";
import type { SidecarDependencyProbe } from "./sidecar-lint-cache.js";

const ABSENT_CONTENT_ANSWER = "absent";

export interface SidecarProbeAnswerResolver {
  /** Current answer for a probe path: content hash / existence class. */
  readonly answerFor: (kind: SidecarDependencyProbe["kind"], relativePath: string) => string;
  /** Root-relative, `/`-separated form every stored probe path uses. */
  readonly toRelativePath: (absolutePath: string) => string;
}

/**
 * Answers dependency probes for the sidecar lint cache — used both when
 * STORING an entry (turn the collector's probe paths into answers) and when
 * VERIFYING one (re-answer each stored probe against the current tree).
 * Store and verify must agree exactly, so both go through this one resolver.
 *
 *   - `content` — SHA-1 of the file's bytes, `"absent"` when unreadable
 *     (missing, a directory, permission failure). Source files reuse the
 *     hashes the cache-partition loop already computed
 *     (`contentHashByRelativePath`); everything else (package.json,
 *     tsconfig, ignored files) is hashed on demand.
 *   - `exists` — the existence class a module-resolution candidate probe
 *     sees: `"file"`, `"dir"`, or `"none"` (missing or an exotic entry —
 *     `statSync` follows symlinks, matching the resolvers).
 *
 * Answers are memoized per scan: the filesystem is frozen for the run, and
 * hot dependency paths (a barrel imported by hundreds of files, the shared
 * tsconfig chain) repeat across many files' probe sets.
 */
export const createSidecarProbeAnswerResolver = (input: {
  rootDirectory: string;
  contentHashByRelativePath: ReadonlyMap<string, string>;
}): SidecarProbeAnswerResolver => {
  const contentAnswerByPath = new Map<string, string>();
  const existsAnswerByPath = new Map<string, string>();
  const directoryAnswerByPath = new Map<string, string>();
  const realpathAnswerByPath = new Map<string, string>();
  // The same dependency paths recur across most files' probe sets (a shared
  // barrel, the tsconfig chain, every node_modules candidate), so the
  // relative form is computed once per absolute path.
  const relativePathByAbsolutePath = new Map<string, string>();

  const toRelativePath = (absolutePath: string): string => {
    const memoized = relativePathByAbsolutePath.get(absolutePath);
    if (memoized !== undefined) return memoized;
    const relativePath = path.relative(input.rootDirectory, absolutePath).replaceAll("\\", "/");
    relativePathByAbsolutePath.set(absolutePath, relativePath);
    return relativePath;
  };

  const contentAnswer = (relativePath: string): string => {
    const memoized = contentAnswerByPath.get(relativePath);
    if (memoized !== undefined) return memoized;
    const answer =
      input.contentHashByRelativePath.get(relativePath) ??
      hashFileContents(path.resolve(input.rootDirectory, relativePath)) ??
      ABSENT_CONTENT_ANSWER;
    contentAnswerByPath.set(relativePath, answer);
    return answer;
  };

  const existsAnswer = (relativePath: string): string => {
    const memoized = existsAnswerByPath.get(relativePath);
    if (memoized !== undefined) return memoized;
    const answer = classifyExistenceAnswer(path.resolve(input.rootDirectory, relativePath));
    existsAnswerByPath.set(relativePath, answer);
    return answer;
  };

  const directoryAnswer = (relativePath: string): string => {
    const previous = directoryAnswerByPath.get(relativePath);
    if (previous !== undefined) return previous;
    let answer: string;
    try {
      const entries = fs.readdirSync(path.resolve(input.rootDirectory, relativePath), {
        withFileTypes: true,
      });
      const members = entries.map((entry) => [
        entry.name,
        entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      ]);
      members.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      answer = createHash("sha256").update(JSON.stringify(members)).digest("hex");
    } catch {
      // Never replay a failed enumeration across scans.
      answer = `unreadable:${randomUUID()}`;
    }
    directoryAnswerByPath.set(relativePath, answer);
    return answer;
  };

  const realpathAnswer = (relativePath: string): string => {
    const cached = realpathAnswerByPath.get(relativePath);
    if (cached !== undefined) return cached;
    let answer: string;
    try {
      const resolved = readRealpathIdentity(path.resolve(input.rootDirectory, relativePath));
      answer = createHash("sha256").update(resolved).digest("hex");
    } catch (error) {
      const code = isErrnoException(error) ? error.code : undefined;
      answer = code === "ENOENT" || code === "ENOTDIR" ? "absent" : `unreadable:${randomUUID()}`;
    }
    realpathAnswerByPath.set(relativePath, answer);
    return answer;
  };
  const resolveAnswer = {
    content: contentAnswer,
    exists: existsAnswer,
    directory: directoryAnswer,
    realpath: realpathAnswer,
  };
  return {
    answerFor: (kind, relativePath) => resolveAnswer[kind](relativePath),
    toRelativePath,
  };
};
