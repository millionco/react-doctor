export type PatchOpType = "add" | "update" | "delete";

export interface PatchOp {
  readonly type: PatchOpType;
  readonly path: string;
  /** For `add`: the full file content lines (without the leading `+`). */
  readonly addedLines?: string[];
  /** For `update`: the raw hunk body lines (` `/`+`/`-`/`@@`). */
  readonly hunkLines?: string[];
  /** For `update` with a `*** Move to:` directive. */
  readonly movePath?: string;
}

const FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE_HEADER = /^\*\*\* Move to: (.+)$/;

/**
 * Parse a Codex / Cursor `apply_patch` envelope (`*** Begin Patch` …
 * `*** End Patch`) into per-file operations. The format carries no line
 * numbers, so `update` ops keep their raw hunk body for a fuzzy line-search
 * apply at reconstruction time. Returns `[]` when no file header is found.
 */
export const parseApplyPatch = (patchText: string): PatchOp[] => {
  const lines = patchText.split("\n");
  const ops: PatchOp[] = [];
  let current: { type: PatchOpType; path: string; movePath?: string; body: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    if (current.type === "add") {
      ops.push({
        type: "add",
        path: current.path,
        addedLines: current.body
          .filter((line) => line.startsWith("+"))
          .map((line) => line.slice(1)),
      });
    } else if (current.type === "update") {
      ops.push({
        type: "update",
        path: current.path,
        hunkLines: current.body,
        ...(current.movePath ? { movePath: current.movePath } : {}),
      });
    } else {
      ops.push({ type: "delete", path: current.path });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) continue;
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      const kind = header[1].toLowerCase();
      current = {
        type: kind === "add" ? "add" : kind === "delete" ? "delete" : "update",
        path: header[2].trim(),
        body: [],
      };
      continue;
    }
    if (!current) continue;
    const move = MOVE_HEADER.exec(line);
    if (move && current.type === "update") {
      current.movePath = move[1].trim();
      continue;
    }
    current.body.push(line);
  }
  flush();
  return ops;
};

/**
 * Apply an `update` hunk body to `baseContent` using a forward line search
 * (the apply_patch format omits line numbers). Returns the new content, or
 * `null` when a context / removed line can't be located — the caller then
 * treats the file as unreconstructable rather than linting wrong content.
 */
export const applyUpdateHunks = (baseContent: string, hunkLines: string[]): string | null => {
  const baseLines = baseContent.split("\n");
  const result: string[] = [];
  let cursor = 0;

  const consumeUntil = (text: string): boolean => {
    for (let index = cursor; index < baseLines.length; index += 1) {
      if (baseLines[index] === text) {
        for (let copy = cursor; copy < index; copy += 1) result.push(baseLines[copy]);
        cursor = index + 1;
        return true;
      }
    }
    return false;
  };

  for (const line of hunkLines) {
    if (line.startsWith("@@")) continue;
    if (line === "") {
      // A bare blank line in a hunk is an unchanged empty context line.
      if (!consumeUntil("")) return null;
      result.push("");
      continue;
    }
    const tag = line[0];
    const text = line.slice(1);
    if (tag === " ") {
      if (!consumeUntil(text)) return null;
      result.push(text);
    } else if (tag === "-") {
      if (!consumeUntil(text)) return null;
    } else if (tag === "+") {
      result.push(text);
    } else {
      // Unknown prefix — treat as context to stay lenient.
      if (!consumeUntil(line)) return null;
      result.push(line);
    }
  }

  for (let index = cursor; index < baseLines.length; index += 1) result.push(baseLines[index]);
  return result.join("\n");
};
