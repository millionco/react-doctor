import * as path from "node:path";
import { STATS_LINTABLE_EXTENSIONS } from "./constants.js";
import { applyUpdateHunks, parseApplyPatch } from "./parse-apply-patch.js";
import type { AgentSession, ReconstructedContent, SessionReconstruction } from "./types.js";

export const isLintablePath = (filePath: string): boolean =>
  STATS_LINTABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));

const resolveAgainstCwd = (rawPath: string, cwd: string | null): string | null => {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return path.normalize(rawPath);
  if (!cwd) return null;
  return path.resolve(cwd, rawPath);
};

const applyStringReplace = (
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string => {
  if (oldString === "") return source;
  if (!source.includes(oldString)) return source;
  return replaceAll
    ? source.split(oldString).join(newString)
    : source.replace(oldString, newString);
};

/**
 * Every absolute file path an agent's edits reference (resolving relatives
 * against the session cwd and parsing apply_patch envelopes). Used by scope
 * filtering to decide whether a session touched the current repo.
 */
export const resolveEditPaths = (session: AgentSession): string[] => {
  const paths = new Set<string>();
  const add = (rawPath: string): void => {
    const resolved = resolveAgainstCwd(rawPath, session.cwd);
    if (resolved) paths.add(resolved);
  };
  for (const edit of session.edits) {
    if (edit.kind === "patch") {
      for (const op of parseApplyPatch(edit.patch ?? "")) add(op.path);
    } else {
      add(edit.path);
    }
  }
  return [...paths];
};

/**
 * Replay a session's edits into the final content of each touched file, as the
 * model left it (Tier 2). Only files with a faithful base (a full write, an
 * apply_patch `Add File`, or a captured read) and a lintable extension are
 * emitted; anything edited without a faithful base is reported as
 * `unreconstructable` and never linted with wrong content.
 */
export const reconstructSession = (session: AgentSession): SessionReconstruction => {
  // `string` = current content, `null` = deleted. Absent = no faithful base yet.
  const buffers = new Map<string, string | null>();
  const touchedLintable = new Set<string>();

  for (const read of session.reads) {
    const resolved = resolveAgainstCwd(read.path, session.cwd);
    if (resolved) buffers.set(resolved, read.content);
  }

  const applyPatchOps = (patchText: string): void => {
    for (const op of parseApplyPatch(patchText)) {
      const resolved = resolveAgainstCwd(op.path, session.cwd);
      if (!resolved) continue;
      if (isLintablePath(resolved)) touchedLintable.add(resolved);
      if (op.type === "add") {
        const lines = op.addedLines ?? [];
        buffers.set(resolved, lines.length > 0 ? `${lines.join("\n")}\n` : "");
      } else if (op.type === "delete") {
        buffers.set(resolved, null);
      } else {
        const base = buffers.get(resolved);
        if (typeof base !== "string") continue;
        const applied = applyUpdateHunks(base, op.hunkLines ?? []);
        if (applied === null) {
          // The hunk didn't match our base, so our buffer is out of sync with
          // what the model actually edited. Drop it to "no faithful base" rather
          // than emit stale content as if it were the reconstructed result.
          buffers.delete(resolved);
          continue;
        }
        const movedTo = op.movePath && resolveAgainstCwd(op.movePath, session.cwd);
        if (movedTo) {
          buffers.set(resolved, null);
          buffers.set(movedTo, applied);
          if (isLintablePath(movedTo)) touchedLintable.add(movedTo);
        } else {
          buffers.set(resolved, applied);
        }
      }
    }
  };

  for (const edit of session.edits) {
    if (edit.kind === "patch") {
      applyPatchOps(edit.patch ?? "");
      continue;
    }
    const resolved = resolveAgainstCwd(edit.path, session.cwd);
    if (!resolved) continue;
    if (isLintablePath(resolved)) touchedLintable.add(resolved);
    if (edit.kind === "write") {
      buffers.set(resolved, edit.content ?? edit.resultContent ?? "");
    } else if (edit.kind === "delete") {
      buffers.set(resolved, null);
    } else {
      const base = buffers.get(resolved);
      if (typeof base !== "string") continue;
      buffers.set(
        resolved,
        applyStringReplace(
          base,
          edit.oldString ?? "",
          edit.newString ?? "",
          edit.replaceAll ?? false,
        ),
      );
    }
  }

  const files: ReconstructedContent[] = [];
  const unreconstructable: string[] = [];
  for (const absolutePath of touchedLintable) {
    const content = buffers.get(absolutePath);
    if (typeof content === "string") {
      files.push({ absolutePath, content });
    } else if (content === undefined) {
      // Edited but never had a faithful base (e.g. a replace on unread content,
      // or a Codex shell edit we couldn't capture). Deleted files (null) are
      // intentional removals, not coverage gaps.
      unreconstructable.push(absolutePath);
    }
  }

  return { session, files, unreconstructable };
};
